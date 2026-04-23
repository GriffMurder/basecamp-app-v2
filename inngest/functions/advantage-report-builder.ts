/**
 * advantage-report-builder — Monthly Advantage Report pipeline
 *
 * Ports report_builder.py + report_metrics.py + report_narrative.py.
 *
 * Monthly cron: 1st of month 14:10 UTC (08:10 CT) — after car-builder (12:00 UTC).
 * Builds client_monthly + va_monthly advantage_reports rows.
 *
 * narrative_json contract: { headline, wins, trend_notes, next_month_focus, closing, ai_used }
 */
import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { uuidV5Oid, vaUuid } from "@/lib/uuid5";

// ── Helpers ──────────────────────────────────────────────────────────────────
function priorMonthBounds(): { periodStart: Date; periodEnd: Date } {
  const today = new Date();
  const firstToday = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastPrev = new Date(firstToday.getTime() - 86_400_000);
  return {
    periodStart: new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1),
    periodEnd: lastPrev,
  };
}

function safeRate(n: number, d: number): number {
  return d <= 0 ? 0 : Math.round((n / d) * 10000) / 10000;
}

function topTaskTypes(mix: Record<string, number>, total: number) {
  const denom = Math.max(total, 1);
  return Object.entries(mix)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => ({ type, count, pct: Math.round((count / denom) * 10000) / 10000 }));
}

// ── Narrative schema ─────────────────────────────────────────────────────────
const NARRATIVE_SCHEMA = {
  headline: "",
  wins: [""],
  trend_notes: "",
  next_month_focus: "",
  closing: "",
};

const SYSTEM_PROMPT =
  "You are an operations analyst at TaskBullet, a premium virtual-assistant service. " +
  "Write short, factual, confident report copy. " +
  "Never mention AI, GPT, or language models. Never exaggerate — use soft qualifiers when uncertain. " +
  "Always cite a specific metric. No corporate filler. Max 1200 chars per section. " +
  "Return JSON only.";

async function callAINarrative(userPrompt: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  const openai = createOpenAI({ apiKey });
  const { text } = await generateText({
    model: openai("gpt-4o-mini"),
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    maxOutputTokens: 900,
  });
  const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return { ...JSON.parse(clean), ai_used: true };
}

// ══════════════════════════════════════════════════════════════════════════════
// CLIENT METRICS
// ══════════════════════════════════════════════════════════════════════════════
async function buildClientMetrics(
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

  // Task stats — via customers.basecamp_project_id → basecamp_todos
  const taskStats = await prisma.$queryRaw<
    { tasks_completed: bigint; avg_turnaround_hours: number | null }[]
  >`
    SELECT
      COUNT(DISTINCT t.basecamp_todo_id)::bigint AS tasks_completed,
      ROUND(AVG(
        EXTRACT(EPOCH FROM (
          COALESCE(t.completed_at, t.updated_at) - t.created_at
        )) / 3600.0
      ) FILTER (WHERE COALESCE(t.completed_at, t.updated_at) IS NOT NULL)::numeric, 2)
        AS avg_turnaround_hours
    FROM basecamp_todos t
    JOIN customers c ON c.basecamp_project_id = t.basecamp_project_id
    WHERE c.id = ${customerId}
      AND t.completed = TRUE
      AND COALESCE(t.completed_at, t.updated_at) BETWEEN ${periodStart} AND ${endOfDay}
  `;

  const tasksCompleted = Number(taskStats[0]?.tasks_completed ?? 0);
  const avgTurnaround = taskStats[0]?.avg_turnaround_hours != null
    ? Number(taskStats[0].avg_turnaround_hours) : null;

  // Quality events
  const qeRows = await prisma.$queryRaw<{ event_type: string; cnt: bigint }[]>`
    SELECT qe.event_type, COUNT(*)::bigint AS cnt
    FROM task_quality_events qe
    JOIN basecamp_todos t ON t.basecamp_todo_id = qe.basecamp_thread_id
    JOIN customers c ON c.basecamp_project_id = t.basecamp_project_id
    WHERE c.id = ${customerId}
      AND qe.created_at BETWEEN ${periodStart} AND ${endOfDay}
    GROUP BY qe.event_type
  `;
  const qeCounts: Record<string, number> = {};
  for (const r of qeRows) qeCounts[r.event_type] = Number(r.cnt);
  const revisionsCount = qeCounts["REVISION_REQUESTED"] ?? 0;
  const praiseCount = qeCounts["PRAISE_SIGNAL"] ?? 0;
  const fpqRate = Math.max(0, 1 - revisionsCount / Math.max(tasksCompleted, 1));

  // No-response events (TB replied, client never followed up)
  const nrRows = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*)::bigint AS cnt
    FROM basecamp_thread_activity bta
    JOIN customers c ON c.basecamp_project_id = bta.basecamp_project_id
    WHERE c.id = ${customerId}
      AND bta.last_tb_reply_at BETWEEN ${periodStart} AND ${endOfDay}
      AND (bta.last_customer_at IS NULL OR bta.last_customer_at < bta.last_tb_reply_at)
  `;
  const noResponseEvents = Number(nrRows[0]?.cnt ?? 0);

  // Continuity events (multi-VA hand-offs)
  const contRows = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*)::bigint AS cnt
    FROM (
      SELECT tw.todo_id
      FROM task_ownership tw
      WHERE tw.customer_id = ${customerId}
        AND tw.created_at BETWEEN ${periodStart} AND ${endOfDay}
      GROUP BY tw.todo_id
      HAVING COUNT(DISTINCT tw.responsible_va_id) > 1
    ) AS multi_va_todos
  `;
  const continuityEvents = Number(contRows[0]?.cnt ?? 0);

  // Task type mix
  const mixRows = await prisma.$queryRaw<{ task_type: string; cnt: bigint }[]>`
    SELECT
      COALESCE(tcr.task_type, 'other') AS task_type,
      COUNT(DISTINCT t.basecamp_todo_id)::bigint AS cnt
    FROM basecamp_todos t
    JOIN customers c ON c.basecamp_project_id = t.basecamp_project_id
    LEFT JOIN task_completion_reports tcr ON tcr.basecamp_thread_id = t.basecamp_todo_id
    WHERE c.id = ${customerId}
      AND t.completed = TRUE
      AND COALESCE(t.completed_at, t.updated_at) BETWEEN ${periodStart} AND ${endOfDay}
    GROUP BY task_type ORDER BY cnt DESC
  `;
  const typeMix: Record<string, number> = {};
  for (const r of mixRows) typeMix[r.task_type] = Number(r.cnt);

  // Payroll waste avoided
  const hoursEstimate = avgTurnaround != null && tasksCompleted > 0
    ? Math.round(tasksCompleted * avgTurnaround * 10) / 10 : 0;
  const payrollWaste = {
    amount_usd: Math.round(hoursEstimate * 20 * 100) / 100,
    hours_estimate: hoursEstimate,
    is_estimate: true,
  };

  return {
    customer_id: customerId,
    customer_name: customer.name,
    effective_tier: customer.effective_tier,
    client_health_score: customer.client_health_score,
    period_start: periodStart.toISOString().slice(0, 10),
    period_end: periodEnd.toISOString().slice(0, 10),
    tasks_completed: tasksCompleted,
    avg_turnaround_hours: avgTurnaround,
    revisions_count: revisionsCount,
    praise_count: praiseCount,
    first_pass_quality_rate: Math.round(fpqRate * 10000) / 10000,
    no_response_events: noResponseEvents,
    continuity_events: continuityEvents,
    top_task_types: topTaskTypes(typeMix, tasksCompleted),
    payroll_waste_avoided: payrollWaste,
  };
}

function buildClientNarrativeFallback(m: Record<string, unknown>): Record<string, unknown> {
  const tasks = m.tasks_completed as number;
  const fpq = m.first_pass_quality_rate as number;
  const revisions = m.revisions_count as number;
  const ta = m.avg_turnaround_hours as number | null;
  const pw = m.payroll_waste_avoided as { amount_usd: number };
  const tier = m.effective_tier ?? "standard";

  const taStr = ta != null ? `${ta.toFixed(1)}h average turnaround` : "on time";
  const pwStr = pw.amount_usd > 0 ? `$${pw.amount_usd.toLocaleString()} in equivalent payroll` : "";

  return {
    headline: `Your team completed ${tasks} tasks this period${pwStr ? `, avoiding ${pwStr}` : ""}.`,
    wins: [
      `${tasks} tasks delivered ${taStr}.`,
      `First-pass quality rate: ${(fpq * 100).toFixed(1)}% (${revisions} revision${revisions !== 1 ? "s" : ""}).`,
      tier !== "standard" ? `Tier ${tier} service maintained throughout the period.` : `Service delivered at standard tier.`,
    ].filter(Boolean),
    trend_notes: revisions > 0
      ? `${revisions} revision request${revisions > 1 ? "s" : ""} noted — we're tracking task clarity as a root cause.`
      : "No revision requests this period — strong first-pass delivery.",
    next_month_focus: "Continue building on this delivery cadence and monitor task clarity at intake.",
    closing: "Thank you for delegating with TaskBullet. We look forward to continuing to serve your team.",
    ai_used: false,
  };
}

async function generateClientNarrative(m: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const ta = m.avg_turnaround_hours as number | null;
    const fpq = m.first_pass_quality_rate as number;
    const pw = m.payroll_waste_avoided as { amount_usd: number; hours_estimate: number };
    const topTypes = (m.top_task_types as { type: string; count: number }[]) ?? [];

    const prompt =
      `TaskBullet Client Monthly Report — ${m.period_start} to ${m.period_end}\n` +
      `Client: ${m.customer_name} (tier ${m.effective_tier ?? "standard"})\n\n` +
      `Tasks completed: ${m.tasks_completed}\n` +
      `Avg turnaround: ${ta != null ? `${ta.toFixed(1)}h` : "N/A"}\n` +
      `First-pass quality: ${(fpq * 100).toFixed(1)}% (${m.revisions_count} revisions)\n` +
      `Praise signals: ${m.praise_count}\n` +
      `No-response threads: ${m.no_response_events}\n` +
      `Continuity events: ${m.continuity_events}\n` +
      `Client health score: ${m.client_health_score != null ? `${m.client_health_score}/100` : "N/A"}\n` +
      `Top task types: ${topTypes.slice(0, 3).map(t => `${t.type} (${t.count})`).join(", ") || "N/A"}\n` +
      `Payroll equivalent avoided: ${pw.amount_usd > 0 ? `$${pw.amount_usd.toLocaleString()}` : "N/A"}\n\n` +
      `Write a headline, 2-5 wins bullets, trend_notes, next_month_focus, and closing.\n` +
      `Return JSON: ${JSON.stringify(NARRATIVE_SCHEMA)}`;

    return await callAINarrative(prompt);
  } catch {
    return buildClientNarrativeFallback(m);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// VA METRICS
// ══════════════════════════════════════════════════════════════════════════════
async function buildVaMetrics(
  vaId: number,
  periodStart: Date,
  periodEnd: Date
): Promise<Record<string, unknown>> {
  const endOfDay = new Date(periodEnd);
  endOfDay.setHours(23, 59, 59, 999);

  const va = await prisma.va.findUnique({
    where: { id: vaId },
    select: { display_name: true, active: true },
  });
  if (!va) throw new Error(`VA ${vaId} not found`);

  // Task stats via task_ownership
  const taskStats = await prisma.$queryRaw<
    { tasks_completed: bigint; avg_turnaround_hours: number | null }[]
  >`
    SELECT
      COUNT(*)::bigint AS tasks_completed,
      ROUND(AVG(
        EXTRACT(EPOCH FROM (
          COALESCE(t.completed_at, t.updated_at) - COALESCE(tw.assigned_at, ${periodStart})
        )) / 3600.0
      ) FILTER (WHERE COALESCE(t.completed_at, t.updated_at) IS NOT NULL AND tw.assigned_at IS NOT NULL)::numeric, 2)
        AS avg_turnaround_hours
    FROM task_ownership tw
    JOIN basecamp_todos t ON t.basecamp_todo_id = tw.todo_id
    WHERE tw.responsible_va_id = ${vaId}
      AND t.completed = TRUE
      AND COALESCE(t.completed_at, t.updated_at) BETWEEN ${periodStart} AND ${endOfDay}
  `;
  const tasksCompleted = Number(taskStats[0]?.tasks_completed ?? 0);
  const avgTurnaround = taskStats[0]?.avg_turnaround_hours != null
    ? Number(taskStats[0].avg_turnaround_hours) : null;

  // Quality events
  const qeRows = await prisma.$queryRaw<{ event_type: string; cnt: bigint }[]>`
    SELECT qe.event_type, COUNT(*)::bigint AS cnt
    FROM task_quality_events qe
    JOIN task_ownership tw ON tw.todo_id = qe.basecamp_thread_id
    WHERE tw.responsible_va_id = ${vaId}
      AND qe.created_at BETWEEN ${periodStart} AND ${endOfDay}
    GROUP BY qe.event_type
  `;
  const qeCounts: Record<string, number> = {};
  for (const r of qeRows) qeCounts[r.event_type] = Number(r.cnt);
  const revisionsCount = qeCounts["REVISION_REQUESTED"] ?? 0;
  const praiseCount = qeCounts["PRAISE_SIGNAL"] ?? 0;
  const revisionRate = safeRate(revisionsCount, tasksCompleted);
  const praiseRate = safeRate(praiseCount, tasksCompleted);

  // Throttle events (low score days)
  const throttleRows = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*)::bigint AS cnt
    FROM scores_daily
    WHERE person_id = ${vaId}
      AND score_type = 'va_reliability'
      AND score_value < 40
      AND day BETWEEN ${periodStart} AND ${endOfDay}
  `;
  const throttleEvents = Number(throttleRows[0]?.cnt ?? 0);

  // Stability score
  const stabilityRaw = 100 - revisionRate * 35 - throttleEvents * 2 + praiseRate * 15;
  const stabilityScore = Math.max(0, Math.min(100, Math.round(stabilityRaw)));

  // Task type mix
  const mixRows = await prisma.$queryRaw<{ task_type: string; cnt: bigint }[]>`
    SELECT tcr.task_type, COUNT(*)::bigint AS cnt
    FROM task_completion_reports tcr
    JOIN task_ownership tw ON tw.todo_id = tcr.basecamp_thread_id
    WHERE tw.responsible_va_id = ${vaId}
      AND tcr.approved_at BETWEEN ${periodStart} AND ${endOfDay}
      AND tcr.status IN ('approved', 'posted')
    GROUP BY tcr.task_type ORDER BY cnt DESC
  `;
  const typeMix: Record<string, number> = {};
  for (const r of mixRows) typeMix[r.task_type] = Number(r.cnt);

  const topTypes = topTaskTypes(typeMix, tasksCompleted);
  const positioningLine = topTypes.length > 0
    ? `You focused on ${topTypes[0].type} work (${topTypes[0].count} tasks).`
    : "You maintained a balanced delivery focus.";

  return {
    va_id: vaId,
    va_name: va.display_name,
    period_start: periodStart.toISOString().slice(0, 10),
    period_end: periodEnd.toISOString().slice(0, 10),
    tasks_completed: tasksCompleted,
    avg_turnaround_hours: avgTurnaround,
    revisions_count: revisionsCount,
    praise_count: praiseCount,
    revision_rate: revisionRate,
    praise_rate: praiseRate,
    throttle_events: throttleEvents,
    stability_score: stabilityScore,
    top_task_types: topTypes,
    positioning_line: positioningLine,
  };
}

function buildVaNarrativeFallback(m: Record<string, unknown>): Record<string, unknown> {
  const tasks = m.tasks_completed as number;
  const ta = m.avg_turnaround_hours as number | null;
  const revRate = m.revision_rate as number;
  const praiseCount = m.praise_count as number;
  const throttle = m.throttle_events as number;
  const stability = m.stability_score as number;
  const positioning = m.positioning_line as string;

  return {
    headline: `${m.va_name} completed ${tasks} tasks this period with a stability score of ${stability}/100.`,
    wins: [
      tasks > 0 ? `${tasks} tasks completed${ta != null ? ` at ${ta.toFixed(1)}h avg turnaround` : ""}.` : null,
      praiseCount > 0 ? `${praiseCount} praise signal${praiseCount > 1 ? "s" : ""} received from clients.` : null,
      positioning,
    ].filter(Boolean),
    trend_notes: throttle > 0
      ? `${throttle} high-load day${throttle > 1 ? "s" : ""} detected — workload balancing may be needed.`
      : revRate > 0.1
      ? `Revision rate of ${(revRate * 100).toFixed(1)}% noted — task clarity at intake is a focus area.`
      : "No overload events and low revision rate — consistent delivery this period.",
    next_month_focus: "Maintain current delivery cadence. Flag any workload spikes early for rebalancing.",
    closing: "Great work this month — your consistency makes a real difference for clients.",
    ai_used: false,
  };
}

async function generateVaNarrative(m: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const ta = m.avg_turnaround_hours as number | null;
    const topTypes = (m.top_task_types as { type: string; count: number }[]) ?? [];

    const prompt =
      `TaskBullet VA Monthly Report — ${m.period_start} to ${m.period_end}\n` +
      `VA: ${m.va_name}\n\n` +
      `Tasks completed: ${m.tasks_completed}\n` +
      `Avg turnaround: ${ta != null ? `${ta.toFixed(1)}h` : "N/A"}\n` +
      `Revision rate: ${((m.revision_rate as number) * 100).toFixed(1)}% (${m.revisions_count} revisions)\n` +
      `Praise rate: ${((m.praise_rate as number) * 100).toFixed(1)}% (${m.praise_count} signals)\n` +
      `Throttle events (overload days): ${m.throttle_events}\n` +
      `Stability score: ${m.stability_score}/100\n` +
      `Top task types: ${topTypes.slice(0, 3).map(t => `${t.type} (${t.count})`).join(", ") || "N/A"}\n` +
      `Positioning: ${m.positioning_line}\n\n` +
      `Frame work positively. Address issues constructively in trend_notes. Closing should be encouraging.\n` +
      `Return JSON: ${JSON.stringify(NARRATIVE_SCHEMA)}`;

    return await callAINarrative(prompt);
  } catch {
    return buildVaNarrativeFallback(m);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// UPSERT
// ══════════════════════════════════════════════════════════════════════════════
async function upsertReport(
  reportType: string,
  subjectId: string,
  periodStart: Date,
  periodEnd: Date,
  metrics: Record<string, unknown>,
  narrative: Record<string, unknown>,
  generationType = "monthly"
) {
  return prisma.advantageReport.upsert({
    where: {
      report_type_subject_id_period_start_period_end: {
        report_type: reportType,
        subject_id: subjectId,
        period_start: periodStart,
        period_end: periodEnd,
      },
    },
    update: {
      metrics_json: metrics as object,
      narrative_json: narrative as object,
      status: "rendered",
      generation_type: generationType,
    },
    create: {
      report_type: reportType,
      subject_id: subjectId,
      period_start: periodStart,
      period_end: periodEnd,
      metrics_json: metrics as object,
      narrative_json: narrative as object,
      status: "rendered",
      generation_type: generationType,
    },
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// INNGEST FUNCTION
// ══════════════════════════════════════════════════════════════════════════════
export const advantageReportBuilder = inngest.createFunction(
  { id: "advantage-report-builder", name: "Advantage Report Builder — Monthly Client + VA Reports" },
  [
    { cron: "10 14 1 * *" }, // 1st of month 14:10 UTC = 08:10 CT
    { event: "tb/advantage-report-builder.trigger" },
  ],
  async ({ event, step }) => {
    const { periodStart, periodEnd } = priorMonthBounds();

    // ── Client reports ───────────────────────────────────────────────────────
    const customers = await step.run("load-clients", () =>
      prisma.customer.findMany({
        where: { active: true },
        select: { id: true, name: true },
        orderBy: { id: "asc" },
      })
    );

    let clientGenerated = 0, clientSkipped = 0, clientErrors = 0;
    for (let i = 0; i < customers.length; i += 5) {
      const batch = customers.slice(i, i + 5);
      const results = await step.run(`client-batch-${i}`, async () => {
        const out = [];
        for (const c of batch) {
          const subjectId = uuidV5Oid(`customer:${c.id}`);
          const existing = await prisma.advantageReport.findUnique({
            where: {
              report_type_subject_id_period_start_period_end: {
                report_type: "client_monthly",
                subject_id: subjectId,
                period_start: periodStart,
                period_end: periodEnd,
              },
            },
            select: { id: true },
          });
          if (existing) { out.push({ ok: true, skipped: true }); continue; }
          try {
            const metrics = await buildClientMetrics(c.id, periodStart, periodEnd);
            if ((metrics.tasks_completed as number) === 0) { out.push({ ok: true, skipped: true }); continue; }
            const narrative = await generateClientNarrative(metrics);
            await upsertReport("client_monthly", subjectId, periodStart, periodEnd, metrics, narrative);
            out.push({ ok: true });
          } catch (e) {
            out.push({ ok: false, error: String(e) });
          }
        }
        return out;
      });
      for (const r of results) {
        if ((r as { skipped?: boolean }).skipped) clientSkipped++;
        else if (r.ok) clientGenerated++;
        else clientErrors++;
      }
    }

    // ── VA reports ───────────────────────────────────────────────────────────
    const vas = await step.run("load-vas", () =>
      prisma.va.findMany({
        where: { active: true },
        select: { id: true, display_name: true },
        orderBy: { id: "asc" },
      })
    );

    let vaGenerated = 0, vaSkipped = 0, vaErrors = 0;
    for (let i = 0; i < vas.length; i += 5) {
      const batch = vas.slice(i, i + 5);
      const results = await step.run(`va-batch-${i}`, async () => {
        const out = [];
        for (const v of batch) {
          const subjectId = vaUuid(v.id);
          const existing = await prisma.advantageReport.findUnique({
            where: {
              report_type_subject_id_period_start_period_end: {
                report_type: "va_monthly",
                subject_id: subjectId,
                period_start: periodStart,
                period_end: periodEnd,
              },
            },
            select: { id: true },
          });
          if (existing) { out.push({ ok: true, skipped: true }); continue; }
          try {
            const metrics = await buildVaMetrics(v.id, periodStart, periodEnd);
            if ((metrics.tasks_completed as number) === 0) { out.push({ ok: true, skipped: true }); continue; }
            const narrative = await generateVaNarrative(metrics);
            await upsertReport("va_monthly", subjectId, periodStart, periodEnd, metrics, narrative);
            out.push({ ok: true });
          } catch (e) {
            out.push({ ok: false, error: String(e) });
          }
        }
        return out;
      });
      for (const r of results) {
        if ((r as { skipped?: boolean }).skipped) vaSkipped++;
        else if (r.ok) vaGenerated++;
        else vaErrors++;
      }
    }

    return {
      period_start: periodStart.toISOString().slice(0, 10),
      period_end: periodEnd.toISOString().slice(0, 10),
      client: { generated: clientGenerated, skipped: clientSkipped, errors: clientErrors },
      va: { generated: vaGenerated, skipped: vaSkipped, errors: vaErrors },
    };
  }
);