/**
 * inngest/functions/manager-escalation.ts
 *
 * Port of app/manager_escalation.py (detection + alert, no Slack modal)
 *
 * Every 30 minutes on weekdays: scan for overdue todos that meet
 * manager-escalation triggers. For each, create a manager-level
 * Intervention and post a Slack alert to OPS_CHANNEL_ID.
 *
 * Triggers (any one fires escalation):
 *   1. Existing open VA intervention with sla_due_at now elapsed
 *   2. Todo overdue > 24 calendar hours past due_on
 *   3. Customer client_health_score < 70
 *
 * Idempotent: skips todos that already have an open/escalated manager
 * intervention.
 *
 * Cron: every 30 min Mon-Fri
 * Also fires on: tb/manager-escalation.requested
 *
 * Env:
 *   OPS_CHANNEL_ID            — Slack channel for escalation alerts
 *   MANAGER_ESC_HEALTH_THRESH — client_health_score threshold (default 70)
 *   MANAGER_ESC_OVERDUE_HOURS — calendar hours overdue to trigger (default 24)
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { WebClient } from "@slack/web-api";

const HEALTH_THRESH   = parseInt(process.env.MANAGER_ESC_HEALTH_THRESH  ?? "70");
const OVERDUE_HOURS   = parseInt(process.env.MANAGER_ESC_OVERDUE_HOURS  ?? "24");
const OPS_CHANNEL     = process.env.OPS_CHANNEL_ID;
const SLACK_TOKEN     = process.env.SLACK_BOT_TOKEN;

// ── Helpers ───────────────────────────────────────────────────────────────────

function todoUrl(urls: unknown): string | null {
  if (urls && typeof urls === "object" && !Array.isArray(urls)) {
    const u = urls as Record<string, unknown>;
    return (u.app_url ?? u.url ?? u.html_url ?? null) as string | null;
  }
  return null;
}

function triggerLabel(t: string, healthScore?: number | null): string {
  const labels: Record<string, string> = {
    va_sla_elapsed:  "VA SLA elapsed",
    overdue_24h:     "Overdue > 24h",
    low_health:      `Low client health (${healthScore ?? "?"})`,
  };
  return labels[t] ?? t;
}

// ── Inngest function ──────────────────────────────────────────────────────────

export const managerEscalation = inngest.createFunction(
  {
    id: "manager-escalation",
    name: "Manager Escalation Scan",
    concurrency: { limit: 1 },
  },
  [
    { cron: "*/30 * * * 1-5" }, // Every 30 min Mon-Fri
    { event: "tb/manager-escalation.requested" },
  ],
  async ({ step, logger }) => {
    const now = new Date();

    // ── Step 1: load overdue todos ─────────────────────────────────────────
    const todos = await step.run("load-overdue-todos", async () => {
      return prisma.basecampTodo.findMany({
        where: {
          completed: false,
          risk_overdue: true,
          OR: [
            { on_hold_until: null },
            { on_hold_until: { lte: now } },
          ],
        },
        select: {
          id: true,
          basecamp_todo_id: true,
          basecamp_project_id: true,
          title: true,
          due_on: true,
          assignee_id: true,
          assignee_name: true,
          urls: true,
          risk_overdue: true,
        },
        take: 200,
      });
    });

    if (!todos.length) {
      logger.info("manager-escalation: no overdue todos");
      return { escalated: 0, skipped: 0 };
    }

    // ── Step 2: pre-fetch existing open manager interventions ─────────────
    const prefetch = await step.run(
      "prefetch-context",
      async () => {
        const todoIdList = todos.map((t) => t.basecamp_todo_id);
        const projectIds = [...new Set(todos.map((t) => t.basecamp_project_id).filter(Boolean))] as string[];

        const [existingMgr, vaIvns, custRows] = await Promise.all([
          prisma.intervention.findMany({
            where: {
              level: "manager",
              status: { in: ["open", "escalated"] },
              todo_id: { in: todoIdList },
            },
            select: { todo_id: true },
          }),
          prisma.intervention.findMany({
            where: {
              level: "va",
              todo_id: { in: todoIdList },
              sla_due_at: { lte: now },
              status: "open",
            },
            select: { todo_id: true, sla_due_at: true, sent_at: true },
          }),
          prisma.customer.findMany({
            where: { basecamp_project_id: { in: projectIds } },
            select: { id: true, name: true, basecamp_project_id: true, client_health_score: true },
          }),
        ]);

        return { existingMgr, vaIvns, custRows };
      }
    );

    // Build lookup structures outside of step.run (Inngest serializes Sets/Maps)
    const openMgrTodoIds = new Set(
      prefetch.existingMgr.map((r) => r.todo_id).filter(Boolean) as string[]
    );
    const openVaIvns = new Map(
      prefetch.vaIvns.map((r) => [r.todo_id ?? "", r])
    );
    const customers = new Map(
      prefetch.custRows.map((c) => [c.basecamp_project_id ?? "", c])
    );

    // ── Step 3: evaluate triggers & escalate ──────────────────────────────
    let escalated = 0;
    let skipped   = 0;

    for (const todo of todos) {
      if (openMgrTodoIds.has(todo.basecamp_todo_id)) {
        skipped++;
        continue;
      }

      const triggers: string[] = [];
      const customer = customers.get(todo.basecamp_project_id ?? "");

      // Trigger 1: VA SLA elapsed
      const vaIvn = openVaIvns.get(todo.basecamp_todo_id);
      if (vaIvn?.sla_due_at && new Date(vaIvn.sla_due_at.toString()) <= now) {
        triggers.push("va_sla_elapsed");
      }

      // Trigger 2: overdue > OVERDUE_HOURS calendar hours
      if (todo.due_on) {
        const dueMs = new Date(todo.due_on).getTime();
        const hoursOverdue = (now.getTime() - dueMs) / 3_600_000;
        if (hoursOverdue >= OVERDUE_HOURS) {
          triggers.push("overdue_24h");
        }
      }

      // Trigger 3: low client health score
      if (customer?.client_health_score != null && Number(customer.client_health_score) < HEALTH_THRESH) {
        triggers.push("low_health");
      }

      if (!triggers.length) {
        skipped++;
        continue;
      }

      // ── Create Intervention & post Slack alert ─────────────────────────
      await step.run(`escalate-todo-${todo.id}`, async () => {
        const now2 = new Date();

        // Create manager intervention
        const intervention = await prisma.intervention.create({
          data: {
            level:      "manager",
            reason:     "needs_manager_action",
            status:     "open",
            todo_id:    todo.basecamp_todo_id,
            customer_id: customer?.id ?? null,
            created_at: now2,
          },
        });

        // Post Slack alert if OPS_CHANNEL is configured
        if (SLACK_TOKEN && OPS_CHANNEL) {
          const url = todoUrl(todo.urls);
          const title = todo.title ?? "(untitled task)";
          const titleLink = url ? `<${url}|${title}>` : `*${title}*`;
          const clientName = customer?.name ?? todo.basecamp_project_id ?? "Unknown client";
          const triggerStr = triggers.map((t) => triggerLabel(t, customer?.client_health_score)).join(" | ");

          const blocks: object[] = [
            {
              type: "header",
              text: { type: "plain_text", text: ":rotating_light: Manager Escalation Required", emoji: true },
            },
            {
              type: "section",
              fields: [
                { type: "mrkdwn", text: `*Task:*\n${titleLink}` },
                { type: "mrkdwn", text: `*Client:*\n${clientName}` },
              ],
            },
            {
              type: "section",
              fields: [
                { type: "mrkdwn", text: `*Triggers:*\n${triggerStr}` },
                { type: "mrkdwn", text: `*VA:*\n${todo.assignee_name ?? "Unassigned"}` },
              ],
            },
            {
              type: "context",
              elements: [
                { type: "mrkdwn", text: `_Intervention ID: ${intervention.id.toString()} | ${now2.toUTCString()}_` },
              ],
            },
          ];

          const slack = new WebClient(SLACK_TOKEN);
          try {
            const result = await slack.chat.postMessage({
              channel: OPS_CHANNEL,
              text: `:rotating_light: Manager escalation: ${title} — ${triggerStr}`,
              blocks: blocks as any,
            });

            // Store message context on intervention
            if (result.ts) {
              await prisma.intervention.update({
                where: { id: intervention.id },
                data: {
                  slack_msg_ts:    result.ts,
                  slack_channel_id: OPS_CHANNEL,
                  sent_at:         now2,
                },
              });
            }
          } catch (err) {
            logger.warn(`manager-escalation: Slack post failed for todo ${todo.basecamp_todo_id}: ${err}`);
          }
        }

        escalated++;
        logger.info(
          `manager-escalation: escalated todo ${todo.basecamp_todo_id} ` +
          `triggers=[${triggers.join(",")}]`
        );
      });
    }

    logger.info(`manager-escalation done: escalated=${escalated} skipped=${skipped}`);
    return { escalated, skipped };
  }
);
