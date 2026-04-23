/**
 * inngest/functions/intake-gate-scan.ts
 *
 * Scheduled function (every hour) that applies the intake gate logic to all
 * incomplete, unassigned Basecamp todos.
 *
 * For each eligible todo:
 *   1. Calls planGateAction() from lib/intake-gate.ts (pure logic)
 *   2. If a prompt is required, posts a Basecamp comment and records it
 *   3. Updates intake_state / intake_ping_count / intake_last_ping_at on
 *      the BasecampTodo row
 *
 * Env flags:
 *   INTAKE_GATE_ENABLED        — master switch (default: false)
 *   INTAKE_PING_COOLDOWN_HOURS — hours between re-pings (default: 24)
 *   INTAKE_MAX_DETAIL_PINGS    — max detail pings per todo (default: 2)
 *   INTAKE_MAX_PLACEHOLDER_PINGS — max placeholder pings (default: 1)
 *   INTAKE_MIN_DETAIL_CHARS    — min char count to be "sufficient" (default: 20)
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { postComment } from "@/lib/basecamp";
import {
  planGateAction,
  detailIsInsufficient,
  PROMPT_KIND_PLACEHOLDER,
  PROMPT_KIND_DETAILS,
  STATE_READY,
} from "@/lib/intake-gate";

// ── Config ────────────────────────────────────────────────────────────────────

const INTAKE_PLACEHOLDER_PROMPT =
  "Hi! 👋 Quick check — is this just a placeholder for now, or would you like us to go ahead and assign it to a VA?";

const INTAKE_DETAILS_PROMPT = [
  "Great — happy to help 👍 To make sure we complete this correctly, could you share:",
  "- What exactly needs to be done?",
  "- Any links, files, or examples?",
  "- Deadline or timeframe (if any)?",
  "- Any preferences or special instructions?",
  "",
  "Once we have this, we'll get it assigned right away.",
].join("\n");

function cooldownMs(): number {
  const hours = parseInt(process.env.INTAKE_PING_COOLDOWN_HOURS ?? "24", 10);
  return (isNaN(hours) ? 24 : hours) * 60 * 60 * 1000;
}

function maxDetailPings(): number {
  return parseInt(process.env.INTAKE_MAX_DETAIL_PINGS ?? "2", 10) || 2;
}

function maxPlaceholderPings(): number {
  return parseInt(process.env.INTAKE_MAX_PLACEHOLDER_PINGS ?? "1", 10) || 1;
}

function minDetailChars(): number {
  return parseInt(process.env.INTAKE_MIN_DETAIL_CHARS ?? "20", 10) || 20;
}

// ── Inngest function ──────────────────────────────────────────────────────────

export const intakeGateScan = inngest.createFunction(
  { id: "intake-gate-scan", name: "Intake Gate Scan", concurrency: 1 },
  { cron: "0 * * * *" }, // every hour
  async ({ step, logger }) => {
    const enabled = (process.env.INTAKE_GATE_ENABLED ?? "false") === "true" ||
      process.env.INTAKE_GATE_ENABLED === "1";

    if (!enabled) {
      logger.info("Intake gate disabled — skipping");
      return { skipped: true, reason: "INTAKE_GATE_ENABLED not set" };
    }

    logger.info("Starting intake gate scan");

    // Fetch eligible todos: incomplete, unassigned, not placeholder_confirmed
    const todos = await step.run("fetch-eligible-todos", async () => {
      return prisma.basecampTodo.findMany({
        where: {
          completed: false,
          assignee_id: null,
          intake_state: { not: "placeholder_confirmed" },
        },
        select: {
          id: true,
          basecamp_todo_id: true,
          basecamp_project_id: true,
          title: true,
          description: true,
          due_on: true,
          intake_state: true,
          intake_ping_count: true,
          intake_last_ping_at: true,
          intake_comment_id: true,
        },
        take: 200,
      });
    });

    logger.info(`Evaluating ${todos.length} eligible todos`);

    const now = new Date();
    const cdMs = cooldownMs();
    const maxDetail = maxDetailPings();
    const maxPlaceholder = maxPlaceholderPings();
    const minChars = minDetailChars();

    let suppressed = 0;
    let prompted = 0;
    let cleared = 0;

    for (const todo of todos) {
      const insufficient = detailIsInsufficient({
        description: todo.description,
        minChars,
        dueOn: todo.due_on,
      });

      const decision = planGateAction({
        state: todo.intake_state,
        insufficient,
        lastPingAt: todo.intake_last_ping_at ? new Date(todo.intake_last_ping_at.toString()) : null,
        pingCount: todo.intake_ping_count,
        now,
        cooldownMs: cdMs,
        maxDetailPings: maxDetail,
        maxPlaceholderPings: maxPlaceholder,
      });

      // Nothing to do — state already matches
      if (
        !decision.prompt_kind &&
        !decision.reset_ping_state &&
        decision.next_state === (todo.intake_state ?? STATE_READY)
      ) {
        if (decision.suppress_slack) suppressed++;
        continue;
      }

      // Post Basecamp comment if needed
      let commentId: string | null = null;
      if (decision.prompt_kind) {
        const commentText =
          decision.prompt_kind === PROMPT_KIND_PLACEHOLDER
            ? INTAKE_PLACEHOLDER_PROMPT
            : INTAKE_DETAILS_PROMPT;

        const projectIdNum = parseInt(todo.basecamp_project_id ?? "", 10);
        const todoIdNum = parseInt(todo.basecamp_todo_id, 10);

        if (!isNaN(projectIdNum) && !isNaN(todoIdNum)) {
          try {
            const posted = await step.run(`post-comment-${todo.id}`, async () => {
              return postComment(projectIdNum, todoIdNum, commentText);
            });
            commentId = posted?.id ? String(posted.id) : null;
            prompted++;
          } catch (err) {
            logger.warn(`Failed to post intake comment for todo ${todo.id}: ${err}`);
          }
        }
      }

      // Persist state changes
      await step.run(`update-todo-${todo.id}`, async () => {
        const pingCount = decision.reset_ping_state
          ? (decision.increment_ping ? 1 : 0)
          : decision.increment_ping
          ? (todo.intake_ping_count ?? 0) + 1
          : (todo.intake_ping_count ?? 0);

        await prisma.basecampTodo.update({
          where: { id: todo.id },
          data: {
            intake_state: decision.next_state,
            intake_ping_count: pingCount,
            intake_last_ping_at: decision.prompt_kind ? now : todo.intake_last_ping_at,
            intake_comment_id: commentId ?? todo.intake_comment_id,
          },
        });
      });

      if (decision.next_state === STATE_READY) {
        cleared++;
      } else if (decision.suppress_slack) {
        suppressed++;
      }
    }

    logger.info(
      `Intake gate scan complete — suppressed=${suppressed} prompted=${prompted} cleared=${cleared}`
    );
    return { suppressed, prompted, cleared, total: todos.length };
  }
);