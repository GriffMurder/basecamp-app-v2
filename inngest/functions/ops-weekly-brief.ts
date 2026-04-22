/**
 * inngest/functions/ops-weekly-brief.ts
 * Replaces Celery task: app.workers.generate_ops_weekly_brief (Mon 09:20 CT)
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { safeChatCompletion } from "@/lib/ai";
import { postToOps } from "@/lib/slack";

export const opsWeeklyBrief = inngest.createFunction(
  { id: "ops-weekly-brief", name: "Ops Weekly Brief", concurrency: 1 },
  { cron: "20 9 * * 1" }, // Mon 09:20 UTC
  async ({ step, logger }) => {
    logger.info("Generating ops weekly brief");

    const weekEnd = new Date();
    weekEnd.setUTCHours(0, 0, 0, 0);
    const weekStart = new Date(weekEnd.getTime() - 7 * 86400_000);

    const stats = await step.run("gather-stats", async () => {
      const [completed, overdue, activeVas] = await Promise.all([
        prisma.basecampTodo.count({
          where: { completed: true, updated_at: { gte: weekStart } },
        }),
        prisma.basecampTodo.count({
          where: { completed: false, due_on: { lt: weekEnd } },
        }),
        prisma.va.count({ where: { active: true } }),
      ]);
      return { completed, overdue, activeVas };
    });

    const briefText = await step.run("generate-brief", async () => {
      const text = await safeChatCompletion([
        { role: "system", content: "You write concise operational summaries for TaskBullet, a VA services company." },
        {
          role: "user",
          content: `Write a weekly ops brief (2-3 bullet points, no headers, Slack-friendly) for the week ending ${weekEnd.toDateString()}:\n- Completed tasks: ${stats.completed}\n- Overdue tasks: ${stats.overdue}\n- Active VAs: ${stats.activeVas}`,
        },
      ]);
      return text ?? `• Completed: ${stats.completed} tasks\n• Overdue: ${stats.overdue} tasks\n• Active VAs: ${stats.activeVas}`;
    });

    await step.run("save-brief", () =>
      prisma.opsWeeklyBrief.create({
        data: {
          week_start: weekStart,
          brief_text: briefText,
          source_data_json: stats,
        },
      })
    );

    await step.run("post-to-slack", () =>
      postToOps(`*Weekly Ops Brief* (w/o ${weekStart.toDateString()})\n${briefText}`)
    );

    return { weekStart: weekStart.toISOString() };
  }
);