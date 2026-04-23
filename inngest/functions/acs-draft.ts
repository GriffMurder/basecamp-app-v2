/**
 * inngest/functions/acs-draft.ts
 *
 * Port of app/completion_report.py (ACS — Auto Completion Summary, Phase 2).
 *
 * Every 30 minutes: scan recently completed BasecampTodos that don't yet
 * have a TaskCompletionReport. For each, call the AI to generate a draft
 * completion summary and persist it with status="drafted".
 *
 * Uses the Vercel AI SDK (xai grok or openai fallback). Falls back to a
 * canned template if the AI call fails.
 *
 * Cron: every 30 minutes Mon–Fri
 * Also fires on: tb/acs-draft.requested
 *
 * Env:
 *   AI_PROVIDER           – "grok" (default) or "openai"
 *   XAI_API_KEY           – required when AI_PROVIDER=grok
 *   OPENAI_API_KEY        – required when AI_PROVIDER=openai
 *   ACS_LOOK_BACK_HOURS   – how far back to look for newly completed todos (default 48)
 *   ACS_MAX_PER_RUN       – max todos to process per run (default 20)
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { generateText } from "ai";
import { xai } from "@ai-sdk/xai";
import { openai } from "@ai-sdk/openai";

const LOOK_BACK_HOURS = parseInt(process.env.ACS_LOOK_BACK_HOURS ?? "48");
const MAX_PER_RUN     = parseInt(process.env.ACS_MAX_PER_RUN ?? "20");

// ── Draft report shape ───────────────────────────────────────────────────────
interface DraftReport {
  what_was_done:   string[];
  where_to_find_it: string;
  quality_checks:  string[];
  next_steps:      string[];
  blockers:        string[];
}

const FALLBACK_REPORT: DraftReport = {
  what_was_done:   ["Task completed as requested."],
  where_to_find_it: "See Basecamp thread for deliverable location.",
  quality_checks:  [],
  next_steps:      [],
  blockers:        [],
};

// ── AI model selector ─────────────────────────────────────────────────────────
function getModel() {
  const provider = (process.env.AI_PROVIDER ?? "grok").toLowerCase();
  if (provider === "openai") return openai("gpt-4o-mini");
  return xai("grok-3-mini");
}

const SYSTEM_PROMPT = `You are an expert operations writer at a virtual-assistant company.
Generate a concise completion summary for a completed task. This is an internal draft.

Return ONLY a raw JSON object (no markdown, no explanation) matching this exact shape:
{
  "what_was_done":    ["bullet 1", "bullet 2"],
  "where_to_find_it": "one phrase ≤ 160 chars",
  "quality_checks":   ["bullet"],
  "next_steps":       ["bullet"],
  "blockers":         []
}

Rules:
- what_was_done: 1–5 bullets describing what was delivered
- where_to_find_it: where the deliverable lives (≤ 160 chars)
- quality_checks: 0–5 quality steps taken; omit if nothing verifiable
- next_steps: 0–5 actions that should happen next (client review, follow-up)
- blockers: 0–3 internal gaps for the VA; use [] if none
- Each bullet ≤ 160 characters. No nulls. No paragraphs.`;

async function generateDraft(
  title: string,
  description: string | null,
  successPlanJson: unknown | null
): Promise<DraftReport> {
  try {
    const planSnippet = successPlanJson
      ? `\n\nSuccess Plan:\n${JSON.stringify(successPlanJson).slice(0, 800)}`
      : "";

    const prompt = `Task: ${title}\n\nDescription: ${(description ?? "(none)").slice(0, 600)}${planSnippet}\n\nGenerate the completion summary JSON.`;

    const { text } = await generateText({
      model: getModel(),
      system: SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: 600,
    });

    // Strip markdown fences if present
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const parsed = JSON.parse(cleaned) as Partial<DraftReport>;

    return {
      what_was_done:   Array.isArray(parsed.what_was_done)   ? parsed.what_was_done   : FALLBACK_REPORT.what_was_done,
      where_to_find_it: typeof parsed.where_to_find_it === "string" ? parsed.where_to_find_it : FALLBACK_REPORT.where_to_find_it,
      quality_checks:  Array.isArray(parsed.quality_checks)  ? parsed.quality_checks  : [],
      next_steps:      Array.isArray(parsed.next_steps)      ? parsed.next_steps      : [],
      blockers:        Array.isArray(parsed.blockers)         ? parsed.blockers         : [],
    };
  } catch {
    return FALLBACK_REPORT;
  }
}

// ── Classify task type from title ─────────────────────────────────────────────
const TYPE_CLUSTERS: [string, string[]][] = [
  ["writing",   ["write", "writing", "content", "copy", "blog", "article", "draft"]],
  ["data",      ["data", "spreadsheet", "excel", "csv", "analysis", "report"]],
  ["admin",     ["admin", "schedule", "calendar", "meeting", "inbox", "email"]],
  ["research",  ["research", "find", "lookup", "search", "gather", "compile"]],
  ["outreach",  ["outreach", "contact", "reach out", "prospect"]],
  ["design",    ["design", "graphic", "canva", "figma", "image", "banner"]],
  ["social",    ["social", "instagram", "facebook", "twitter", "caption"]],
  ["technical", ["code", "technical", "website", "wordpress", "api", "script"]],
];

function classifyTaskType(title: string): string {
  const low = (title ?? "").toLowerCase();
  for (const [type, keywords] of TYPE_CLUSTERS) {
    if (keywords.some((kw) => low.includes(kw))) return type;
  }
  return "general";
}

// ── Inngest function ──────────────────────────────────────────────────────────
export const acsDraft = inngest.createFunction(
  {
    id: "acs-draft",
    name: "ACS Draft Generator",
    concurrency: { limit: 1 },
  },
  [
    { cron: "*/30 * * * 1-5" },
    { event: "tb/acs-draft.requested" },
  ],
  async ({ step, logger }) => {
    const since = new Date(Date.now() - LOOK_BACK_HOURS * 3_600_000);

    // ── Step 1: find eligible todos ─────────────────────────────────────────
    const todos = await step.run("find-completed-todos", async () => {
      return prisma.basecampTodo.findMany({
        where: {
          completed: true,
          completed_at: { gte: since },
          // Exclude todos that already have a completion report (join-less check via sub-select)
        },
        select: {
          id: true,
          basecamp_todo_id: true,
          title: true,
          description: true,
          basecamp_project_id: true,
          assignee_id: true,
          completed_at: true,
        },
        orderBy: { completed_at: "desc" },
        take: MAX_PER_RUN * 2, // over-fetch; we'll filter below
      });
    });

    if (!todos.length) {
      logger.info("acs-draft: no recently completed todos");
      return { eligible: 0, drafted: 0, skipped: 0 };
    }

    // ── Step 2: filter out todos that already have reports ──────────────────
    const existing = await step.run("find-existing-reports", async () => {
      const ids = todos.map((t) => t.basecamp_todo_id);
      const reports = await prisma.taskCompletionReport.findMany({
        where: { basecamp_thread_id: { in: ids } },
        select: { basecamp_thread_id: true },
      });
      return reports.map((r) => r.basecamp_thread_id);
    });

    const existingSet = new Set(existing);
    const eligible = todos.filter((t) => !existingSet.has(t.basecamp_todo_id)).slice(0, MAX_PER_RUN);

    if (!eligible.length) {
      logger.info("acs-draft: all recent todos already have reports");
      return { eligible: 0, drafted: 0, skipped: todos.length };
    }

    logger.info(`acs-draft: ${eligible.length} todos eligible for draft`);

    let drafted = 0;
    let skipped = 0;
    let errors = 0;

    // ── Step 3: generate draft for each eligible todo ───────────────────────
    for (const todo of eligible) {
      const result = await step.run(`draft-${todo.id}`, async () => {
        try {
          // Double-check idempotency
          const alreadyExists = await prisma.taskCompletionReport.findUnique({
            where: { basecamp_thread_id: todo.basecamp_todo_id },
            select: { id: true },
          });
          if (alreadyExists) return { action: "skipped" as const };

          // Look up success plan for context
          const plan = await prisma.taskSuccessPlan.findFirst({
            where: { basecamp_thread_id: todo.basecamp_todo_id },
            select: { id: true, generated_plan: true, va_modified_plan: true, status: true },
            orderBy: { created_at: "desc" },
          });

          const planJson = plan ? (plan.va_modified_plan ?? plan.generated_plan) : null;

          const draft = await generateDraft(
            todo.title ?? "(untitled)",
            todo.description,
            planJson
          );

          const taskType = classifyTaskType(todo.title ?? "");

          await prisma.taskCompletionReport.create({
            data: {
              basecamp_thread_id: todo.basecamp_todo_id,
              task_type: taskType,
              draft_report: draft as object,
              status: "drafted",
              ...(plan ? { success_plan_id: plan.id } : {}),
              completed_at: todo.completed_at ?? new Date(),
            },
          });

          return { action: "drafted" as const };
        } catch (err) {
          return { action: "error" as const, error: String(err) };
        }
      });

      if (result.action === "drafted") drafted++;
      else if (result.action === "skipped") skipped++;
      else {
        errors++;
        logger.error(`acs-draft: error on todo ${todo.id}: ${(result as { error: string }).error}`);
      }
    }

    logger.info(`acs-draft: done. eligible=${eligible.length} drafted=${drafted} skipped=${skipped} errors=${errors}`);
    return { eligible: eligible.length, drafted, skipped, errors };
  }
);
