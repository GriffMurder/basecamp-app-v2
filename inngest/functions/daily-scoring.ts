/**
 * inngest/functions/daily-scoring.ts
 * Replaces Celery task: app.workers.run_daily_scoring (Mon-Fri 08:07 CT)
 *
 * Computes VA reliability score from completed vs overdue BasecampTodos
 * and writes a ScoreDaily row per active VA.
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";

export const dailyScoring = inngest.createFunction(
  { id: "daily-scoring", name: "Daily VA & Client Scoring", concurrency: 1 },
  { cron: "7 8 * * 1-5" }, // Mon-Fri 08:07 UTC
  async ({ step, logger }) => {
    logger.info("Starting daily scoring run");
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const vas = await step.run("load-vas", () =>
      prisma.va.findMany({
        where: { active: true },
        select: { id: true, slack_user_id: true, basecamp_person_id: true, display_name: true },
      })
    );

    let scored = 0;
    for (const va of vas) {
      if (!va.basecamp_person_id) continue;

      await step.run(`score-va-${va.id}`, async () => {
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000);

        // Completed in last 7 days (assigned to this VA)
        const completed7d = await prisma.basecampTodo.count({
          where: {
            assignee_id: va.basecamp_person_id,
            completed: true,
            updated_at: { gte: sevenDaysAgo },
          },
        });

        // Currently overdue (open + past due_on)
        const overdue = await prisma.basecampTodo.count({
          where: {
            assignee_id: va.basecamp_person_id,
            completed: false,
            due_on: { lt: today },
          },
        });

        const total = completed7d + overdue;
        const reliabilityRaw = total === 0 ? 50 : Math.round((completed7d / total) * 100);

        // Prisma composite unique with nullable columns requires skipDuplicates workaround
        await prisma.scoreDaily.deleteMany({
          where: { day: today, score_type: "reliability", person_id: va.id, customer_id: null },
        });
        await prisma.scoreDaily.create({
          data: {
            day: today,
            person_id: va.id,
            score_type: "reliability",
            score_value: reliabilityRaw,
            flags: { completed7d, overdue },
          },
        });

        // Also update Va.reliability_score (rolling)
        await prisma.va.update({
          where: { id: va.id },
          data: { reliability_score: reliabilityRaw, last_scored_at: today },
        });

        scored++;
      });
    }

    logger.info(`Daily scoring complete — scored ${scored} VAs`);
    return { scored, date: today.toISOString() };
  }
);