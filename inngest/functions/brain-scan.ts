/**
 * Brain Scan — AI job card generator for unassigned todos
 *
 * Fetches unassigned, open todos from the DB, calls the AI Brain service to
 * generate a job card summary for each, then posts them to JOB_BOARD_CHANNEL_ID
 * (falls back to OPS_CHANNEL_ID).
 *
 * Runs daily at 09:00 UTC Mon–Fri, and on-demand via event `tb/brain-scan.requested`.
 * Guard: JOB_BOARD_AI_RECOMMEND_ENABLED must be "true".
 */
import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { WebClient } from "@slack/web-api";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

// Keyword clusters for task-type classification
const TYPE_CLUSTERS: [string, string[]][] = [
  ["writing",   ["write", "writing", "content", "copy", "blog", "article", "draft"]],
  ["data",      ["data", "spreadsheet", "excel", "csv", "analysis", "report"]],
  ["admin",     ["admin", "schedule", "calendar", "meeting", "inbox", "email"]],
  ["research",  ["research", "find", "lookup", "search", "gather", "compile"]],
  ["outreach",  ["outreach", "contact", "reach out", "prospect", "linkedin"]],
  ["design",    ["design", "graphic", "canva", "figma", "image", "banner"]],
  ["social",    ["social", "instagram", "facebook", "twitter", "caption"]],
  ["technical", ["code", "technical", "website", "wordpress", "api", "script"]],
  ["video",     ["video", "youtube", "edit", "clip", "reel", "transcript"]],
];

function classifyTask(title: string): string {
  const low = title.toLowerCase();
  for (const [name, keywords] of TYPE_CLUSTERS) {
    if (keywords.some((kw) => low.includes(kw))) return name;
  }
  return "general";
}

async function callAiBrain(title: string, description: string | null): Promise<string | null> {
  const token = process.env.AI_BRAIN_TOKEN;
  const url = process.env.AI_BRAIN_URL ?? "http://localhost:8001";
  if (!token) return null;

  try {
    const res = await fetch(`${url}/job-card`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title, description: description ?? "" }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { summary?: string; notes?: string };
    return data.summary ?? data.notes ?? null;
  } catch {
    return null;
  }
}

export const brainScan = inngest.createFunction(
  {
    id: "brain-scan-daily",
    name: "Brain Scan: Daily Unassigned Todo AI Cards",
    concurrency: { limit: 1 },
  },
  [{ cron: "0 9 * * 1-5" }, { event: "tb/brain-scan.requested" }],
  async ({ step }) => {
    const enabled = process.env.JOB_BOARD_AI_RECOMMEND_ENABLED === "true";
    if (!enabled) {
      return { skipped: true, reason: "JOB_BOARD_AI_RECOMMEND_ENABLED not set" };
    }

    const channelId = process.env.JOB_BOARD_CHANNEL_ID ?? process.env.OPS_CHANNEL_ID;
    if (!channelId) {
      return { skipped: true, reason: "No channel ID set" };
    }

    // Fetch unassigned, open todos updated in the last 7 days
    const unassignedTodos = await step.run("fetch-unassigned-todos", async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return prisma.basecampTodo.findMany({
        where: {
          completed: false,
          assignee_id: null,
          updated_at: { gte: since },
        },
        orderBy: [{ due_on: "asc" }, { updated_at: "desc" }],
        take: 20,
        select: {
          id: true,
          basecamp_todo_id: true,
          basecamp_todolist_id: true,
          title: true,
          description: true,
          due_on: true,
          basecamp_project_id: true,
          lifecycle_state: true,
        },
      });
    });

    if (unassignedTodos.length === 0) {
      return { ok: true, scanned: 0, message: "No unassigned todos found" };
    }

    // Process each todo and post to Slack
    const results = await step.run("post-job-cards", async () => {
      const bcAccountId = process.env.BASECAMP_ACCOUNT_ID ?? "3260428";
      let posted = 0;

      for (const todo of unassignedTodos) {
        const title = todo.title ?? "Untitled task";
        const cluster = classifyTask(title);

        // Try AI brain for enhanced summary; fallback to title
        let aiSummary: string | null = null;
        try {
          aiSummary = await callAiBrain(title, todo.description);
        } catch {
          // Graceful fallback
        }

        const lines: string[] = [
          `*🧠 Brain Scan — Job Card*`,
          `*Task:* ${title}`,
          `*Type:* ${cluster}`,
        ];

        if (todo.due_on) {
          const dueStr = new Date(todo.due_on).toLocaleDateString("en-US", {
            month: "short", day: "numeric",
          });
          lines.push(`*Due:* ${dueStr}`);
        }

        if (todo.lifecycle_state && todo.lifecycle_state !== "CREATED") {
          lines.push(`*Lifecycle:* ${todo.lifecycle_state.replace(/_/g, " ")}`);
        }

        if (aiSummary) {
          lines.push(`*AI Notes:* ${aiSummary}`);
        }

        const bcUrl = `https://3.basecamp.com/${bcAccountId}/buckets/${todo.basecamp_todolist_id ?? ""}/todos/${todo.basecamp_todo_id}`;
        lines.push(`<${bcUrl}|Open in Basecamp>`);

        try {
          await slack.chat.postMessage({
            channel: channelId,
            text: lines.join("\n"),
          });
          posted++;
        } catch {
          // continue on individual failure
        }
      }

      return { posted };
    });

    return {
      ok: true,
      scanned: unassignedTodos.length,
      posted: results.posted,
    };
  }
);
