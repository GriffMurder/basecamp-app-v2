/**
 * car-builder — Client Advantage Report (CAR) Inngest function
 *
 * Ports car_builder.py from the Python app.
 *
 * Monthly cron: 1st of month at 06:00 CT (12:00 UTC).
 * Collects metrics per active customer → AI narrative → upsert car_reports.
 *
 * Also handles manual trigger: { data: { customer_id?, period_start?, period_end? } }
 */
import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const HOURS_SAVED_MULTIPLIER = 1.5;
const HOURS_SAVED_CAP = 200;

// ── Period helpers ───────────────────────────────────────────────────────────
function priorMonthBounds(): { periodStart: Date; periodEnd: Date } {
  const today = new Date();
  const firstToday = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastPrev = new Date(firstToday.getTime() - 86_400_000); // day before
  const periodStart = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1);
  const periodEnd = lastPrev;
  return { periodStart, periodEnd };
}

// ── Metrics collection ───────────────────────────────────────────────────────
async function collectCarMetrics(
  customerId: number,
  periodStart: Date,
  periodEnd: Date
): Promise<Record<string, unknown>> {
  const endOfDay = new Date(periodEnd);
  endOfDay.setHours(23, 59, 59, 999);

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { name: true, client_health_score: true, effective_tier: true },
  });
  if (!customer) throw new Error(`Customer ${customerId} not found`);

  // Task stats via task_ownership + basecamp_todos
  const taskStats = await prisma.$queryRaw<
    { tasks_completed: bigint; avg_turnaround_hours: number | null }[]
  >`
    SELECT
      COUNT(DISTINCT tw.id)::bigint AS tasks_completed,
      ROUND(AVG(
        EXTRACT(EPOCH FROM (t.completed_at - t.assigned_at)) / 3600.0
      ) FILTER (WHERE t.completed_at IS NOT NULL AND t.assigned_at IS NOT NULL)::numeric, 2)
        AS avg_turnaround_hours
    FROM task_ownership tw
    JOIN basecamp_todos t ON t.basecamp_todo_id = tw.todo_id
    WHERE tw.customer_id = ${customerId}
      AND t.completed = TRUE
      AND t.updated_at BETWEEN ${periodStart} AND ${endOfDay}
  `;

  const tasksCompleted = Number(taskStats[0]?.tasks_completed ?? 0);
  const avgTurnaround = taskStats[0]?.avg_turnaround_hours
    ? Number(taskStats[0].avg_turnaround_hours)
    : null;

  // SLA compliance: % threads with reply within 4h of customer message
  const slaRows = await prisma.$queryRaw<
    { total: bigint; compliant: bigint }[]
  >`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (
        WHERE last_tb_reply_at IS NOT NULL
          AND EXTRACT(EPOCH FROM (last_tb_reply_at - last_customer_at)) / 3600.0 <= 4
      )::bigint AS compliant
    FROM basecamp_thread_activity bta
    JOIN task_ownership tw ON tw.todo_id = bta.basecamp_todo_id
    WHERE tw.customer_id = ${customerId}
      AND bta.last_customer_at BETWEEN ${periodStart} AND ${endOfDay}
  `;
  const slaTotal = Number(slaRows[0]?.total ?? 0);
  const slaCompliant = Number(slaRows[0]?.compliant ?? 0);
  const slaComplianceRate = slaTotal > 0 ? slaCompliant / slaTotal : 1.0;

  // Revision rate: % reports with blockers in approved_report
  const revRows = await prisma.$queryRaw<
    { total: bigint; revised: bigint }[]
  >`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (
        WHERE approved_report IS NOT NULL
          AND jsonb_array_length(COALESCE(approved_report->'blockers', '[]'::jsonb)) > 0
      )::bigint AS revised
    FROM task_completion_reports tcr
    JOIN task_ownership tw ON tw.todo_id = tcr.basecamp_thread_id
    WHERE tw.customer_id = ${customerId}
      AND tcr.created_at BETWEEN ${periodStart} AND ${endOfDay}
  `;
  const revTotal = Number(revRows[0]?.total ?? 0);
  const revRevised = Number(revRows[0]?.revised ?? 0);
  const revisionRate = revTotal > 0 ? revRevised / revTotal : 0;

  // Task type mix
  const mixRows = await prisma.$queryRaw<
    { task_type: string; cnt: bigint }[]
  >`
    SELECT
      COALESCE(t.workflow_state, 'general') AS task_type,
      COUNT(*)::bigint AS cnt
    FROM task_ownership tw
    JOIN basecamp_todos t ON t.basecamp_todo_id = tw.todo_id
    WHERE tw.customer_id = ${customerId}
      AND t.completed = TRUE
      AND t.updated_at BETWEEN ${periodStart} AND ${endOfDay}
    GROUP BY task_type
    ORDER BY cnt DESC
  `;
  const taskTypeMix: Record<string, number> = {};
  for (const row of mixRows) {
    taskTypeMix[row.task_type] = Number(row.cnt);
  }

  // Hours saved estimate
  let hoursSaved = 0;
  if (avgTurnaround && tasksCompleted > 0) {
    hoursSaved = Math.min(
      Math.round(tasksCompleted * avgTurnaround * HOURS_SAVED_MULTIPLIER * 10) / 10,
      HOURS_SAVED_CAP
    );
  }

  return {
    customer_id: customerId,
    customer_name: customer.name,
    effective_tier: customer.effective_tier,
    client_health_score: customer.client_health_score,
    period_start: periodStart.toISOString().slice(0, 10),
    period_end: periodEnd.toISOString().slice(0, 10),
    tasks_completed: tasksCompleted,
    avg_turnaround_hours: avgTurnaround,
    sla_compliance_rate: slaComplianceRate,
    revision_rate: revisionRate,
    hours_saved_estimate: hoursSaved,
    task_type_mix: taskTypeMix,
  };
}

// ── Fallback narrative (deterministic) ──────────────────────────────────────
function buildFallbackNarrative(metrics: Record<string, unknown>): Record<string, unknown> {
  const tasks = metrics.tasks_completed as number;
  const hours = metrics.hours_saved_estimate as number;
  const sla = Math.round((metrics.sla_compliance_rate as number) * 100 * 10) / 10;
  const rev = Math.round((metrics.revision_rate as number) * 100 * 10) / 10;
  const health = metrics.client_health_score as number | null;
  const ta = metrics.avg_turnaround_hours as number | null;

  const taStr = ta != null ? `${ta.toFixed(1)} hours` : "within your service tier";
  const healthStr =
    health != null
      ? `Your account health score is ${health}/100.`
      : "Your account is in good standing.";
  const qualityBlurb =
    `Tasks were completed with a ${rev}% rework rate — ` +
    (rev < 15 ? "well within expectations." : "something we're actively monitoring.");

  return {
    headline:
      `Your TaskBullet team handled ${tasks} tasks this period` +
      (hours > 0 ? `, returning an estimated ${hours} hours to your schedule.` : "."),
    sections: {
      volume: {
        label: "Delegation Volume",
        blurb: `${tasks} tasks were completed on your behalf during this period.`,
      },
      speed: {
        label: "Delivery Speed",
        blurb: `Work was delivered with an average turnaround of ${taStr}.`,
      },
      quality: {
        label: "Quality & Accuracy",
        blurb: qualityBlurb,
      },
      health: {
        label: "Relationship Health",
        blurb: `${healthStr} SLA compliance stood at ${sla}%.`,
      },
      savings: {
        label: "Your Time Back",
        blurb:
          hours > 0
            ? `Delegation freed an estimated ${hours} hours of your time this month.`
            : "Delegation continues to protect your calendar and focus.",
      },
    },
    closing:
      "We look forward to continuing to serve your delegation needs " +
      "and will keep optimizing for speed and quality.",
    ai_used: false,
  };
}

// ── AI narrative ─────────────────────────────────────────────────────────────
async function generateNarrative(
  metrics: Record<string, unknown>
): Promise<Record<string, unknown>> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");

    const openai = createOpenAI({ apiKey });
    const period = `${metrics.period_start} to ${metrics.period_end}`;
    const slaStr = `${Math.round((metrics.sla_compliance_rate as number) * 100 * 10) / 10}%`;
    const revStr = `${Math.round((metrics.revision_rate as number) * 100 * 10) / 10}%`;

    const userPrompt =
      `TaskBullet Client Advantage Report — ${period}\n\n` +
      `Client tier: ${metrics.effective_tier ?? "standard"}\n` +
      `Tasks completed this period: ${metrics.tasks_completed}\n` +
      `Average turnaround time: ${metrics.avg_turnaround_hours != null ? `${(metrics.avg_turnaround_hours as number).toFixed(1)}h` : "N/A"}\n` +
      `SLA compliance rate: ${slaStr}\n` +
      `Revision/rework rate: ${revStr}\n` +
      `Client health score: ${metrics.client_health_score != null ? `${metrics.client_health_score}/100` : "N/A"}\n` +
      `Estimated hours returned to client: ${metrics.hours_saved_estimate}h\n\n` +
      `Write 5 section blurbs + 1 headline + 1 closing. Return JSON with keys: headline, sections (volume/speed/quality/health/savings each with label+blurb), closing.`;

    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      system:
        "You are a client-success analyst at TaskBullet, a premium virtual-assistant service. " +
        "Write short, factual, confident report blurbs — 1-2 sentences each. " +
        "Never use filler phrases. Use the metrics provided. Do not invent data. Return JSON only.",
      prompt: userPrompt,
      maxOutputTokens: 800,
    });

    const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(clean);
    return { ...parsed, ai_used: true };
  } catch (err) {
    console.warn("[car-builder] AI narrative failed, using fallback:", err);
    return buildFallbackNarrative(metrics);
  }
}

// ── Build and upsert a single CAR ───────────────────────────────────────────
async function buildCarReport(
  customerId: number,
  periodStart: Date,
  periodEnd: Date,
  generationType = "monthly"
): Promise<{ ok: boolean; customer_id: number; report_id?: number; error?: string }> {
  try {
    const metrics = await collectCarMetrics(customerId, periodStart, periodEnd);
    const narrative = await generateNarrative(metrics);

    const report = await prisma.carReport.upsert({
      where: {
        customer_id_period_start_period_end: {
          customer_id: customerId,
          period_start: periodStart,
          period_end: periodEnd,
        },
      },
      update: {
        metrics_json: metrics as object,
        narrative_json: narrative as object,
        generated_at: new Date(),
        generation_type: generationType,
      },
      create: {
        customer_id: customerId,
        period_start: periodStart,
        period_end: periodEnd,
        metrics_json: metrics as object,
        narrative_json: narrative as object,
        generation_type: generationType,
      },
    });

    return { ok: true, customer_id: customerId, report_id: report.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[car-builder] ERROR customer_id=${customerId}: ${msg}`);
    return { ok: false, customer_id: customerId, error: msg };
  }
}

// ── Inngest function ─────────────────────────────────────────────────────────
export const carBuilder = inngest.createFunction(
  { id: "car-builder", name: "CAR Builder — Monthly Client Advantage Reports" },
  [
    { cron: "0 12 1 * *" }, // 1st of month 12:00 UTC = 06:00 CT
    { event: "tb/car-builder.trigger" },
  ],
  async ({ event, step }) => {
    // Manual single-customer trigger
    const manualCustomerId = event.data?.customer_id as number | undefined;
    const manualStart = event.data?.period_start as string | undefined;
    const manualEnd = event.data?.period_end as string | undefined;

    if (manualCustomerId) {
      const { periodStart, periodEnd } = manualStart && manualEnd
        ? {
            periodStart: new Date(manualStart),
            periodEnd: new Date(manualEnd),
          }
        : priorMonthBounds();

      const result = await step.run("build-single-car", () =>
        buildCarReport(manualCustomerId, periodStart, periodEnd, "manual")
      );
      return { mode: "manual", result };
    }

    // Monthly batch — all active customers
    const { periodStart, periodEnd } = priorMonthBounds();

    const customers = await step.run("load-active-customers", async () => {
      const rows = await prisma.customer.findMany({
        where: { active: true },
        select: { id: true, name: true },
        orderBy: { id: "asc" },
      });
      return rows;
    });

    let generated = 0;
    let skipped = 0;
    let errors = 0;

    // Process in batches of 5 to avoid overwhelming the DB/AI
    for (let i = 0; i < customers.length; i += 5) {
      const batch = customers.slice(i, i + 5);
      const results = await step.run(`batch-${i}`, async () => {
        const batchResults = [];
        for (const c of batch) {
          // Skip if already generated this period
          const existing = await prisma.carReport.findUnique({
            where: {
              customer_id_period_start_period_end: {
                customer_id: c.id,
                period_start: periodStart,
                period_end: periodEnd,
              },
            },
            select: { id: true },
          });
          if (existing) {
            batchResults.push({ ok: true, customer_id: c.id, skipped: true });
            continue;
          }
          const r = await buildCarReport(c.id, periodStart, periodEnd, "monthly");
          batchResults.push(r);
        }
        return batchResults;
      });

      for (const r of results) {
        if ((r as { skipped?: boolean }).skipped) skipped++;
        else if (r.ok) generated++;
        else errors++;
      }
    }

    return {
      period_start: periodStart.toISOString().slice(0, 10),
      period_end: periodEnd.toISOString().slice(0, 10),
      total_customers: customers.length,
      generated,
      skipped,
      errors,
    };
  }
);