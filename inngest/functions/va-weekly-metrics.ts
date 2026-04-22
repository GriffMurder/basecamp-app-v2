/**
 * inngest/functions/va-weekly-metrics.ts
 * Replaces Celery task: app.workers.compute_va_weekly_metrics (Mon 08:11 CT)
 *
 * Counts completed BasecampTodo assignments per VA for the prior week
 * and writes into VaWeeklyMetric.
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";

export const vaWeeklyMetrics = inngest.createFunction(
  { id: "va-weekly-metrics", name: "VA Weekly Metrics", concurrency: 1 },
  { cron: "11 8 * * 1" }, // Mon 08:11 UTC
  async ({ step, logger }) => {
    logger.info("Computing VA weekly metrics");

    const weekEnd = new Date();
    weekEnd.setUTCHours(0, 0, 0, 0);
    const weekStart = new Date(weekEnd.getTime() - 7 * 86400_000);

    const vas = await step.run("load-vas", () =>
      prisma.va.findMany({
        where: { active: true },
        select: { id: true, slack_user_id: true, basecamp_person_id: true },
      })
    );

    let written = 0;
    for (const va of vas) {
      if (!va.basecamp_person_id || !va.slack_user_id) continue;
      const vaSlackId = va.slack_user_id; // narrowed to string after null check above

      await step.run(`metrics-va-${va.id}`, async () => {
        const completed = await prisma.basecampTodo.count({
          where: {
            assignee_id: va.basecamp_person_id,
            completed: true,
            updated_at: { gte: weekStart, lt: weekEnd },
          },
        });

        // VaWeeklyMetric tracks job-board interactions (interested, selected, assigned, completed)
        // For now we write completed_count from BasecampTodo as a baseline.
        await prisma.vaWeeklyMetric.create({
          data: {
            slack_user_id: vaSlackId,
            week_start: weekStart,
            completed_count: completed,
          },
        });
        written++;
      });
    }

    logger.info(`VA weekly metrics: wrote ${written} rows for week starting ${weekStart.toISOString()}`);
    return { written, weekStart: weekStart.toISOString() };
  }
);