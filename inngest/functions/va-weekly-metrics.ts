/**
 * inngest/functions/va-weekly-metrics.ts
 * Replaces Celery task: app.workers.compute_va_weekly_metrics (Mon 08:11 CT)
 *
 * Counts completed BasecampTodo assignments per VA for the prior week,
 * writes into VaWeeklyMetric, then generates an AI scorecard (va_scorecard.py
 * pattern) and upserts into VaPerformanceSnapshot.metrics_json.
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { vaUuid } from "@/lib/uuid5";

const SCORECARD_SYSTEM_PROMPT =
  "You are an operations analyst creating a weekly VA scorecard. " +
  "Provide strengths and weaknesses with reasoning and evidence. " +
  "Return JSON only with keys: summary, strengths, weaknesses, risks, task_focus, recommendations, questions, text.";

const SCORECARD_SCHEMA = {
  summary: "",
  strengths: [{ title: "", reasoning: "", evidence: [] }],
  weaknesses: [{ title: "", reasoning: "", evidence: [] }],
  risks: [],
  task_focus: [],
  recommendations: [{ title: "", reasoning: "", evidence: [] }],
  questions: [],
  text: "",
};

async function generateScorecard(
  weekStart: Date,
  sourceData: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return buildScorecardFallback(weekStart, sourceData);
  try {
    const openai = createOpenAI({ apiKey });
    const userPrompt =
      `Week start: ${weekStart.toISOString().slice(0, 10)}\n` +
      `VA data (JSON):\n${JSON.stringify(sourceData, null, 2)}\n\n` +
      `Return JSON only using this schema:\n${JSON.stringify(SCORECARD_SCHEMA, null, 2)}`;
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      system: SCORECARD_SYSTEM_PROMPT,
      prompt: userPrompt,
      maxOutputTokens: 700,
    });
    const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return { ...JSON.parse(clean), ai_used: true };
  } catch {
    return buildScorecardFallback(weekStart, sourceData);
  }
}

function buildScorecardFallback(
  weekStart: Date,
  sourceData: Record<string, unknown>
): Record<string, unknown> {
  const m = (sourceData.metrics ?? {}) as Record<string, unknown>;
  const assigned = Number(m.assigned_count ?? 0);
  const completed = Number(m.completed_count ?? 0);
  const completionRate = m.completion_rate as number | null;
  const slaRate = m.sla_compliance_rate as number | null;
  const pending = Number(m.pending_followups ?? 0);
  const rework = Number(m.rework_count ?? 0);
  const openAssigned = Number(m.open_assigned_count ?? 0);

  const strengths = [];
  const weaknesses = [];
  const risks: string[] = [];
  const recommendations = [];

  if (completed >= 3 && completionRate != null && completionRate >= 0.8) {
    strengths.push({ title: "Consistent completion", reasoning: "High completion rate indicates reliable delivery.", evidence: [`completed=${completed}`, `completion_rate=${completionRate.toFixed(2)}`] });
  } else if (assigned === 0) {
    weaknesses.push({ title: "No recent assignments", reasoning: "No assignments recorded for the week.", evidence: [`assigned=${assigned}`] });
  }
  if (slaRate != null && slaRate >= 0.9) {
    strengths.push({ title: "Strong SLA compliance", reasoning: "Client follow-ups handled within expectations.", evidence: [`sla_compliance_rate=${slaRate.toFixed(2)}`] });
  } else if (pending > 0) {
    weaknesses.push({ title: "SLA followups pending", reasoning: "Pending followups indicate delayed responses.", evidence: [`pending_followups=${pending}`] });
  }
  if (rework === 0 && completed > 0) {
    strengths.push({ title: "Low rework signals", reasoning: "No rework signals detected.", evidence: [`rework_count=0`] });
  } else if (rework > 0) {
    weaknesses.push({ title: "Rework signals", reasoning: "Tasks marked for reassignment suggest quality gaps.", evidence: [`rework_count=${rework}`] });
  }
  if (completionRate != null && completionRate < 0.6 && assigned > 0) {
    risks.push("Low completion rate may affect client confidence.");
    recommendations.push({ title: "Review task execution cadence", reasoning: "Completion rate below target.", evidence: [`completion_rate=${completionRate.toFixed(2)}`] });
  }
  if (openAssigned > 5) {
    risks.push("High open assignments may indicate overload.");
    recommendations.push({ title: "Rebalance workload", reasoning: "Open assignments elevated.", evidence: [`open_assigned_count=${openAssigned}`] });
  }

  const summary = completionRate != null
    ? `assigned=${assigned}, completed=${completed}, completion_rate=${completionRate.toFixed(2)}`
    : `assigned=${assigned}, completed=${completed}`;

  return {
    summary, strengths, weaknesses, risks,
    task_focus: sourceData.task_categories ?? [],
    recommendations,
    questions: [
      "Does this VA need additional support for dominant task types?",
      "Is weekly capacity aligned with current assignment load?",
    ],
    text: `VA Weekly Scorecard (${weekStart.toISOString().slice(0, 10)})\nSummary: ${summary}`,
    ai_used: false,
  };
}

export const vaWeeklyMetrics = inngest.createFunction(
  { id: "va-weekly-metrics", name: "VA Weekly Metrics", concurrency: 1 },
  { cron: "11 8 * * 1" }, // Mon 08:11 UTC
  async ({ step, logger }) => {
    logger.info("Computing VA weekly metrics + scorecards");

    const weekEnd = new Date();
    weekEnd.setUTCHours(0, 0, 0, 0);
    const weekStart = new Date(weekEnd.getTime() - 7 * 86400_000);
    const weekEndOfDay = new Date(weekEnd.getTime() - 1); // 1ms before midnight

    const vas = await step.run("load-vas", () =>
      prisma.va.findMany({
        where: { active: true },
        select: { id: true, slack_user_id: true, basecamp_person_id: true, display_name: true },
      })
    );

    let written = 0;
    let scorecards = 0;
    for (const va of vas) {
      if (!va.basecamp_person_id || !va.slack_user_id) continue;
      const vaSlackId = va.slack_user_id;

      await step.run(`metrics-va-${va.id}`, async () => {
        const completed = await prisma.basecampTodo.count({
          where: {
            assignee_id: va.basecamp_person_id,
            completed: true,
            updated_at: { gte: weekStart, lt: weekEnd },
          },
        });

        await prisma.vaWeeklyMetric.create({
          data: {
            slack_user_id: vaSlackId,
            week_start: weekStart,
            completed_count: completed,
          },
        });
        written++;

        // Pending followups from BTA
        const pendingFollowups = await prisma.basecampThreadActivity.count({
          where: { assigned_va_id: vaSlackId, pending_human_followup: true, resolved_at: null },
        });

        // Open assigned todos
        const openAssigned = await prisma.basecampTodo.count({
          where: { assignee_id: va.basecamp_person_id, completed: false },
        });

        // SLA compliance: threads with TB reply within 4h
        const slaTotal = await prisma.basecampThreadActivity.count({
          where: { assigned_va_id: vaSlackId, last_customer_at: { gte: weekStart, lte: weekEndOfDay } },
        });
        const slaCompliant = await prisma.$queryRaw<{ cnt: bigint }[]>`
          SELECT COUNT(*)::bigint AS cnt
          FROM basecamp_thread_activity
          WHERE assigned_va_id = ${vaSlackId}
            AND last_customer_at BETWEEN ${weekStart} AND ${weekEndOfDay}
            AND last_tb_reply_at IS NOT NULL
            AND EXTRACT(EPOCH FROM (last_tb_reply_at - last_customer_at)) / 3600.0 <= 4
        `;
        const slaRate = slaTotal > 0 ? Number(slaCompliant[0]?.cnt ?? 0) / slaTotal : null;

        const completionRate = completed > 0 || openAssigned > 0
          ? completed / Math.max(completed + openAssigned, 1)
          : null;

        const sourceData = {
          va_id: va.id,
          va_name: va.display_name,
          metrics: {
            assigned_count: completed + openAssigned,
            completed_count: completed,
            completion_rate: completionRate,
            sla_compliance_rate: slaRate,
            pending_followups: pendingFollowups,
            rework_count: 0,
            open_assigned_count: openAssigned,
          },
          task_categories: [],
        };

        const scorecard = await generateScorecard(weekStart, sourceData);

        // Upsert into VaPerformanceSnapshot
        const vaUuidStr = vaUuid(va.id);
        await prisma.vaPerformanceSnapshot.upsert({
          where: {
            va_perf_snap_unique: {
              va_id: vaUuidStr,
              period_start: weekStart,
              period_end: weekEnd,
            },
          },
          update: {
            metrics_json: {
              completed,
              completion_rate: completionRate,
              sla_rate: slaRate,
              pending_followups: pendingFollowups,
              open_assigned: openAssigned,
              scorecard,
            } as object,
            updated_at: new Date(),
          },
          create: {
            va_id: vaUuidStr,
            period_start: weekStart,
            period_end: weekEnd,
            metrics_json: {
              completed,
              completion_rate: completionRate,
              sla_rate: slaRate,
              pending_followups: pendingFollowups,
              open_assigned: openAssigned,
              scorecard,
            } as object,
          },
        });
        scorecards++;
      });
    }

    logger.info(`VA weekly metrics: ${written} metric rows, ${scorecards} scorecards, week=${weekStart.toISOString()}`);
    return { written, scorecards, weekStart: weekStart.toISOString() };
  }
);