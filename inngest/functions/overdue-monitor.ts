/**
 * inngest/functions/overdue-monitor.ts
 *
 * Port of app/overdue_monitor.py
 *
 * Every 15 minutes on weekdays: scan for overdue or due-soon BasecampTodos
 * that haven't been responded to. For each, create an open Intervention
 * (level=va, reason=overdue_or_silence) and DM the responsible VA.
 *
 * Idempotent: skips todos that already have an open va/overdue_or_silence
 * intervention. Only runs Mon–Fri.
 *
 * Cron: every 15 minutes Mon–Fri
 * Also fires on: tb/overdue-monitor.requested
 *
 * Env:
 *   OVERDUE_VA_SLA_HOURS  – calendar hours given to VA before SLA breach (default 6)
 *   OVERDUE_LOOK_AHEAD_DAYS – how many days ahead to consider "due soon" (default 1)
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { sendDM } from "@/lib/slack";

const VA_SLA_HOURS = parseInt(process.env.OVERDUE_VA_SLA_HOURS ?? "6");
const LOOK_AHEAD_DAYS = parseInt(process.env.OVERDUE_LOOK_AHEAD_DAYS ?? "1");

export const overdueMonitor = inngest.createFunction(
  {
    id: "overdue-monitor",
    name: "Overdue Monitor",
    concurrency: { limit: 1 },
  },
  [
    { cron: "*/15 * * * 1-5" },
    { event: "tb/overdue-monitor.requested" },
  ],
  async ({ step, logger }) => {
    // ── Step 1: load overdue / due-soon todos ─────────────────────────────
    const todos = await step.run("load-overdue-todos", async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + LOOK_AHEAD_DAYS);

      return prisma.basecampTodo.findMany({
        where: {
          completed: false,
          OR: [
            { risk_overdue: true },
            { due_on: { lte: cutoff }, risk_due_soon: true },
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
          risk_overdue: true,
          urls: true,
        },
        take: 200,
      });
    });

    if (!todos.length) {
      logger.info("overdue-monitor: no overdue/due-soon todos");
      return { todos: 0, created: 0, skipped: 0, dmsent: 0 };
    }

    logger.info(`overdue-monitor: ${todos.length} todos to process`);

    let created = 0;
    let skipped = 0;
    let dmsent = 0;
    let errors = 0;

    // ── Step 2: process each todo ─────────────────────────────────────────
    for (const todo of todos) {
      const result = await step.run(`process-${todo.id}`, async () => {
        try {
          // Skip if open intervention already exists
          const existing = await prisma.intervention.findFirst({
            where: {
              todo_id: todo.basecamp_todo_id,
              level: "va",
              reason: "overdue_or_silence",
              status: "open",
            },
            select: { id: true },
          });

          if (existing) return { action: "skipped" as const };

          // Create intervention
          const slaDue = new Date(Date.now() + VA_SLA_HOURS * 3_600_000);

          const ivn = await prisma.intervention.create({
            data: {
              level: "va",
              reason: "overdue_or_silence",
              status: "open",
              todo_id: todo.basecamp_todo_id,
              target_person_id: todo.assignee_id ?? null,
              sla_due_at: slaDue,
            },
            select: { id: true },
          });

          // Resolve VA slack user ID via Person table
          const va = todo.assignee_id
            ? await prisma.person.findFirst({
                where: { basecamp_person_id: todo.assignee_id, role: "va", active: true },
                select: { slack_user_id: true },
              })
            : null;

          if (!va?.slack_user_id) {
            return { action: "created" as const, dmsent: false };
          }

          // Build DM text
          const status = todo.risk_overdue ? "🔴 *Overdue*" : "🟡 *Due soon*";
          const dueStr = todo.due_on
            ? new Date(todo.due_on.toString()).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : "no due date";
          const urls = (todo.urls as Record<string, string> | null) ?? {};
          const link = urls.app ?? urls.url ?? "";
          const dmText = [
            `${status} — *${todo.title ?? "(untitled task)"}*`,
            `Due: ${dueStr}`,
            link ? `<${link}|View in Basecamp>` : null,
            "",
            "Please give a quick status update on this task.",
          ]
            .filter(Boolean)
            .join("\n");

          const ts = await sendDM(va.slack_user_id, dmText);

          if (ts) {
            await prisma.intervention.update({
              where: { id: ivn.id },
              data: { sent_at: new Date() },
            });
          }

          return { action: "created" as const, dmsent: !!ts };
        } catch (err) {
          logger.error(`overdue-monitor: error processing todo ${todo.id}: ${String(err)}`);
          return { action: "error" as const };
        }
      });

      if (result.action === "skipped") skipped++;
      else if (result.action === "created") {
        created++;
        if (result.dmsent) dmsent++;
      } else {
        errors++;
      }
    }

    logger.info(
      `overdue-monitor: done. todos=${todos.length} created=${created} skipped=${skipped} dmsent=${dmsent} errors=${errors}`
    );
    return { todos: todos.length, created, skipped, dmsent, errors };
  }
);
