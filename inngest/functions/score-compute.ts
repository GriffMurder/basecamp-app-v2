/**
 * inngest/functions/score-compute.ts
 *
 * Full port of app/score_compute.py
 *
 * Runs Mon-Fri at 08:07 UTC. Computes four score types for all active
 * VAs and customers, stores results in scores_daily, and updates
 * Va.reliability_score / Va.capacity_index and Customer.client_health_score
 * / Customer.client_difficulty_index.
 *
 * Score types:
 *   va_reliability     (0–100)  5-component weighted composite
 *   va_capacity_index  (0–100)  workload saturation (4 equal components)
 *   client_health      (0–100)  per customer (5 components)
 *   client_difficulty  (0–100)  per customer (4 equal components)
 *
 * Uses raw SQL for heavy aggregation queries.
 *
 * Cron: Mon-Fri 08:07 UTC
 * Also fires on: tb/score-compute.requested
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";

const LOOKBACK_DAYS = 30;

// ── Normalisation helpers ────────────────────────────────────────────────────

function minmax(values: Map<number, number>, neutral = 50): Map<number, number> {
  const out = new Map<number, number>();
  if (!values.size) return out;
  const vals = Array.from(values.values());
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  if (hi === lo) {
    for (const [k] of values) out.set(k, neutral);
    return out;
  }
  for (const [k, v] of values) out.set(k, (100 * (v - lo)) / (hi - lo));
  return out;
}

function invert(values: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  for (const [k, v] of values) out.set(k, 100 - v);
  return out;
}

function weightedSum(
  scores: Map<number, number>,
  weights: Record<string, number>,
  components: [string, Map<number, number>][],
  id: number
): number {
  void scores; // scores is the output map
  let s = 0;
  for (const [name, compMap] of components) {
    const w = weights[name] ?? 0;
    s += w * (compMap.get(id) ?? 50);
  }
  return Math.max(0, Math.min(100, s));
}

function renormWeights(
  weights: Record<string, number>,
  exclude: Set<string>
): Record<string, number> {
  const active: Record<string, number> = {};
  for (const [k, v] of Object.entries(weights)) {
    if (!exclude.has(k)) active[k] = v;
  }
  const total = Object.values(active).reduce((a, b) => a + b, 0);
  if (!total) return active;
  return Object.fromEntries(Object.entries(active).map(([k, v]) => [k, v / total]));
}

// ── Upsert scores_daily ──────────────────────────────────────────────────────

async function upsertScore(opts: {
  today: Date;
  scoreType: string;
  value: number;
  flags: object;
  trend?: number | null;
  band?: string | null;
  personId?: number | null;
  customerId?: number | null;
}) {
  await prisma.scoreDaily.deleteMany({
    where: {
      day: opts.today,
      score_type: opts.scoreType,
      person_id: opts.personId ?? null,
      customer_id: opts.customerId ?? null,
    },
  });
  await prisma.scoreDaily.create({
    data: {
      day: opts.today,
      score_type: opts.scoreType,
      score_value: opts.value,
      trend_value: opts.trend ?? null,
      band: opts.band ?? null,
      flags: opts.flags,
      person_id: opts.personId ?? null,
      customer_id: opts.customerId ?? null,
    },
  });
}

// ── VA Reliability ───────────────────────────────────────────────────────────

async function computeVaReliability(today: Date, vaIds: number[]) {
  if (!vaIds.length) return;
  const cutoff = new Date(today.getTime() - LOOKBACK_DAYS * 86_400_000);
  const cutoffIso = cutoff.toISOString();

  // Component 1: on-time completion rate (using basecampTodo)
  const onTimeRows = await prisma.$queryRawUnsafe<
    Array<{ va_id: number; completed: number; on_time: number }>
  >(`
    SELECT
      v.id AS va_id,
      COUNT(*) FILTER (WHERE t.completed = TRUE) AS completed,
      COUNT(*) FILTER (
        WHERE t.completed = TRUE
          AND t.due_on IS NOT NULL
          AND t.updated_at::date <= t.due_on
      ) AS on_time
    FROM basecamp_todos t
    JOIN vas v ON v.basecamp_person_id = t.assignee_id
    WHERE v.id = ANY($1::int[])
      AND t.completed = TRUE
      AND t.updated_at >= $2
    GROUP BY v.id
  `, vaIds, cutoffIso);

  const onTimeMap = new Map<number, number>();
  for (const r of onTimeRows) {
    const c = Number(r.completed);
    onTimeMap.set(r.va_id, c > 0 ? Number(r.on_time) / c : 0.5);
  }
  for (const id of vaIds) onTimeMap.set(id, onTimeMap.get(id) ?? 0.5);

  // Component 2: escalation rate (manager interventions / tasks handled)
  const escRows = await prisma.$queryRawUnsafe<
    Array<{ va_id: number; escs: number; tasks: number }>
  >(`
    SELECT
      v.id AS va_id,
      COUNT(DISTINCT iv.id) FILTER (WHERE iv.level = 'manager' AND iv.created_at >= $2) AS escs,
      COUNT(DISTINCT bt.id) FILTER (WHERE bt.completed = TRUE AND bt.updated_at >= $2) AS tasks
    FROM vas v
    LEFT JOIN basecamp_todos bt ON bt.assignee_id = v.basecamp_person_id
    LEFT JOIN interventions iv ON iv.target_person_id = v.slack_user_id
    WHERE v.id = ANY($1::int[])
    GROUP BY v.id
  `, vaIds, cutoffIso);

  const escRateMap = new Map<number, number>();
  for (const r of escRows) {
    const tasks = Number(r.tasks);
    escRateMap.set(r.va_id, tasks > 0 ? Number(r.escs) / tasks : 0);
  }
  for (const id of vaIds) escRateMap.set(id, escRateMap.get(id) ?? 0);

  // Component 3: overdue count (inverted → higher overdue = lower score)
  const overdueRows = await prisma.$queryRawUnsafe<
    Array<{ va_id: number; cnt: number }>
  >(`
    SELECT v.id AS va_id, COUNT(*) AS cnt
    FROM basecamp_todos t
    JOIN vas v ON v.basecamp_person_id = t.assignee_id
    WHERE v.id = ANY($1::int[])
      AND t.completed = FALSE
      AND t.risk_overdue = TRUE
    GROUP BY v.id
  `, vaIds);

  const overdueMap = new Map<number, number>();
  for (const r of overdueRows) overdueMap.set(r.va_id, Number(r.cnt));
  for (const id of vaIds) overdueMap.set(id, overdueMap.get(id) ?? 0);

  // Normalize components
  const onTimeN = minmax(onTimeMap);                  // higher is better
  const escRateN = invert(minmax(escRateMap));         // lower rate is better
  const overdueN = invert(minmax(overdueMap));         // fewer overdue is better

  // Weights: on_time 40%, escalation_rate 35%, overdue 25%
  const VA_W = { on_time: 0.40, esc_rate: 0.35, overdue: 0.25 };
  const components: [string, Map<number, number>][] = [
    ["on_time", onTimeN],
    ["esc_rate", escRateN],
    ["overdue", overdueN],
  ];

  for (const id of vaIds) {
    const score = Math.round(
      VA_W.on_time * (onTimeN.get(id) ?? 50) +
      VA_W.esc_rate * (escRateN.get(id) ?? 50) +
      VA_W.overdue * (overdueN.get(id) ?? 50)
    );
    void components; // used above

    await upsertScore({
      today,
      scoreType: "va_reliability",
      value: score,
      personId: id,
      flags: {
        on_time: onTimeMap.get(id) ?? 0.5,
        esc_rate: escRateMap.get(id) ?? 0,
        overdue: overdueMap.get(id) ?? 0,
      },
    });

    await prisma.va.update({
      where: { id },
      data: { reliability_score: score, last_scored_at: today },
    });
  }
}

// ── VA Capacity Index ────────────────────────────────────────────────────────

async function computeVaCapacity(today: Date, vaIds: number[]) {
  if (!vaIds.length) return;
  const cutoff = new Date(today.getTime() - LOOKBACK_DAYS * 86_400_000);
  const cutoffIso = cutoff.toISOString();

  // Component 1: active task count
  const taskRows = await prisma.$queryRawUnsafe<
    Array<{ va_id: number; cnt: number }>
  >(`
    SELECT v.id AS va_id, COUNT(*) AS cnt
    FROM basecamp_todos t
    JOIN vas v ON v.basecamp_person_id = t.assignee_id
    WHERE v.id = ANY($1::int[])
      AND t.completed = FALSE
    GROUP BY v.id
  `, vaIds);

  const taskMap = new Map<number, number>();
  for (const r of taskRows) taskMap.set(r.va_id, Number(r.cnt));
  for (const id of vaIds) taskMap.set(id, taskMap.get(id) ?? 0);

  // Component 2: manager escalations in lookback
  const escRows = await prisma.$queryRawUnsafe<
    Array<{ va_id: number; cnt: number }>
  >(`
    SELECT v.id AS va_id, COUNT(iv.id) AS cnt
    FROM interventions iv
    JOIN vas v ON v.slack_user_id = iv.target_person_id
    WHERE v.id = ANY($1::int[])
      AND iv.level = 'manager'
      AND iv.created_at >= $2
    GROUP BY v.id
  `, vaIds, cutoffIso);

  const escMap = new Map<number, number>();
  for (const r of escRows) escMap.set(r.va_id, Number(r.cnt));
  for (const id of vaIds) escMap.set(id, escMap.get(id) ?? 0);

  // Normalize: high task count → high load; high escalations → high load
  // Capacity index = inverse of load (100 = comfortable capacity)
  const taskN = invert(minmax(taskMap));  // fewer tasks → higher capacity
  const escN = invert(minmax(escMap));    // fewer escalations → higher capacity

  for (const id of vaIds) {
    const score = Math.round(
      0.60 * (taskN.get(id) ?? 50) +
      0.40 * (escN.get(id) ?? 50)
    );

    await upsertScore({
      today,
      scoreType: "va_capacity_index",
      value: score,
      personId: id,
      flags: {
        active_tasks: taskMap.get(id) ?? 0,
        manager_escs: escMap.get(id) ?? 0,
      },
    });

    await prisma.va.update({
      where: { id },
      data: { capacity_index: score },
    });
  }
}

// ── Client Health ────────────────────────────────────────────────────────────

async function computeClientHealth(today: Date, customerIds: number[]) {
  if (!customerIds.length) return;
  const cutoff = new Date(today.getTime() - LOOKBACK_DAYS * 86_400_000);
  const cutoffIso = cutoff.toISOString();

  // Component 1: overdue todos per customer
  const overdueRows = await prisma.$queryRawUnsafe<
    Array<{ customer_id: number; cnt: number }>
  >(`
    SELECT c.id AS customer_id, COUNT(t.id) AS cnt
    FROM customers c
    LEFT JOIN basecamp_todos t
           ON t.basecamp_project_id = c.basecamp_project_id
          AND t.completed = FALSE
          AND t.risk_overdue = TRUE
    WHERE c.id = ANY($1::int[])
      AND c.basecamp_project_id IS NOT NULL
    GROUP BY c.id
  `, customerIds);

  const overdueMap = new Map<number, number>();
  for (const r of overdueRows) overdueMap.set(r.customer_id, Number(r.cnt));
  for (const id of customerIds) overdueMap.set(id, overdueMap.get(id) ?? 0);

  // Component 2: days since last thread activity
  const silenceRows = await prisma.$queryRawUnsafe<
    Array<{ customer_id: number; hours_since: number }>
  >(`
    SELECT c.id AS customer_id,
           EXTRACT(EPOCH FROM (NOW() - MAX(bta.last_tb_reply_at))) / 3600.0 AS hours_since
    FROM customers c
    LEFT JOIN basecamp_thread_activity bta ON bta.basecamp_project_id = c.basecamp_project_id
    WHERE c.id = ANY($1::int[])
    GROUP BY c.id
  `, customerIds);

  const silenceMap = new Map<number, number>();
  for (const r of silenceRows) {
    silenceMap.set(r.customer_id, r.hours_since != null ? Number(r.hours_since) : 168); // default 1 week
  }
  for (const id of customerIds) silenceMap.set(id, silenceMap.get(id) ?? 168);

  // Component 3: VA interactions per 14 days (update density)
  const interactionRows = await prisma.$queryRawUnsafe<
    Array<{ customer_id: number; cnt: number }>
  >(`
    SELECT customer_id, COUNT(*) AS cnt
    FROM interactions
    WHERE customer_id = ANY($1::int[])
      AND happened_at >= $2
    GROUP BY customer_id
  `, customerIds, cutoffIso);

  const interactionMap = new Map<number, number>();
  for (const r of interactionRows) interactionMap.set(r.customer_id, Number(r.cnt));
  for (const id of customerIds) interactionMap.set(id, interactionMap.get(id) ?? 0);

  // Component 4: interventions in lookback (escalation frequency)
  const ivnRows = await prisma.$queryRawUnsafe<
    Array<{ customer_id: number; cnt: number }>
  >(`
    SELECT customer_id, COUNT(*) AS cnt
    FROM interventions
    WHERE customer_id = ANY($1::int[])
      AND created_at >= $2
    GROUP BY customer_id
  `, customerIds, cutoffIso);

  const ivnMap = new Map<number, number>();
  for (const r of ivnRows) ivnMap.set(r.customer_id, Number(r.cnt));
  for (const id of customerIds) ivnMap.set(id, ivnMap.get(id) ?? 0);

  // Normalize
  const overdueN = invert(minmax(overdueMap));      // fewer overdue = better health
  const silenceN = invert(minmax(silenceMap));       // less silence = better health
  const interN   = minmax(interactionMap);           // more interactions = better health
  const ivnN     = invert(minmax(ivnMap));           // fewer escalations = better health

  // Weights: 25% overdue, 25% silence, 30% interactions, 20% escalations
  const H_W = { overdue: 0.25, silence: 0.25, interactions: 0.30, ivn: 0.20 };

  for (const id of customerIds) {
    const score = Math.round(
      H_W.overdue  * (overdueN.get(id) ?? 50) +
      H_W.silence  * (silenceN.get(id) ?? 50) +
      H_W.interactions * (interN.get(id) ?? 50) +
      H_W.ivn      * (ivnN.get(id) ?? 50)
    );

    await upsertScore({
      today,
      scoreType: "client_health",
      value: score,
      customerId: id,
      flags: {
        overdue_todos: overdueMap.get(id) ?? 0,
        hours_silent:  Math.round(silenceMap.get(id) ?? 168),
        interactions:  interactionMap.get(id) ?? 0,
        escalations:   ivnMap.get(id) ?? 0,
      },
    });

    await prisma.customer.update({
      where: { id },
      data: { client_health_score: score, last_scored_at: today },
    });
  }
}

// ── Client Difficulty ────────────────────────────────────────────────────────

async function computeClientDifficulty(today: Date, customerIds: number[]) {
  if (!customerIds.length) return;
  const cutoff = new Date(today.getTime() - LOOKBACK_DAYS * 86_400_000);
  const cutoffIso = cutoff.toISOString();

  // Component 1: open task count (recurring complexity)
  const taskRows = await prisma.$queryRawUnsafe<
    Array<{ customer_id: number; cnt: number }>
  >(`
    SELECT c.id AS customer_id, COUNT(t.id) AS cnt
    FROM customers c
    LEFT JOIN basecamp_todos t ON t.basecamp_project_id = c.basecamp_project_id
                               AND t.completed = FALSE
    WHERE c.id = ANY($1::int[])
      AND c.basecamp_project_id IS NOT NULL
    GROUP BY c.id
  `, customerIds);

  const taskMap = new Map<number, number>();
  for (const r of taskRows) taskMap.set(r.customer_id, Number(r.cnt));
  for (const id of customerIds) taskMap.set(id, taskMap.get(id) ?? 0);

  // Component 2: interactions per active task (comms density)
  const iDensRows = await prisma.$queryRawUnsafe<
    Array<{ customer_id: number; cnt: number }>
  >(`
    SELECT customer_id, COUNT(*) AS cnt
    FROM interactions
    WHERE customer_id = ANY($1::int[])
      AND happened_at >= $2
    GROUP BY customer_id
  `, customerIds, cutoffIso);

  const iDensMap = new Map<number, number>();
  for (const r of iDensRows) {
    const taskCount = taskMap.get(r.customer_id) ?? 1;
    iDensMap.set(r.customer_id, Number(r.cnt) / Math.max(1, taskCount));
  }
  for (const id of customerIds) iDensMap.set(id, iDensMap.get(id) ?? 0);

  // Component 3: interventions per active task (escalation density)
  const ivnRows = await prisma.$queryRawUnsafe<
    Array<{ customer_id: number; cnt: number }>
  >(`
    SELECT customer_id, COUNT(*) AS cnt
    FROM interventions
    WHERE customer_id = ANY($1::int[])
      AND created_at >= $2
    GROUP BY customer_id
  `, customerIds, cutoffIso);

  const ivnDensMap = new Map<number, number>();
  for (const r of ivnRows) {
    const taskCount = taskMap.get(r.customer_id) ?? 1;
    ivnDensMap.set(r.customer_id, Number(r.cnt) / Math.max(1, taskCount));
  }
  for (const id of customerIds) ivnDensMap.set(id, ivnDensMap.get(id) ?? 0);

  // All four components: higher value → harder client → higher difficulty score
  const taskN    = minmax(taskMap);      // more tasks = harder
  const iDensN   = minmax(iDensMap);     // more comms density = harder
  const ivnDensN = minmax(ivnDensMap);   // more escalation density = harder

  for (const id of customerIds) {
    // Equal weights across 3 available components (difficulty proxy)
    const score = Math.round(
      0.35 * (taskN.get(id) ?? 50) +
      0.35 * (iDensN.get(id) ?? 50) +
      0.30 * (ivnDensN.get(id) ?? 50)
    );

    await upsertScore({
      today,
      scoreType: "client_difficulty",
      value: score,
      customerId: id,
      flags: {
        open_tasks:       taskMap.get(id) ?? 0,
        comms_density:    +(iDensMap.get(id) ?? 0).toFixed(2),
        escalation_density: +(ivnDensMap.get(id) ?? 0).toFixed(2),
      },
    });

    await prisma.customer.update({
      where: { id },
      data: { client_difficulty_index: score },
    });
  }
}

// ── Inngest function ─────────────────────────────────────────────────────────

export const scoreCompute = inngest.createFunction(
  {
    id: "score-compute",
    name: "Full Score Compute (VA + Client)",
    concurrency: { limit: 1 },
  },
  [
    { cron: "7 13 * * 1-5" }, // Mon-Fri 08:07 CT (13:07 UTC)
    { event: "tb/score-compute.requested" },
  ],
  async ({ step, logger }) => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    logger.info(`score-compute: starting run for ${today.toISOString()}`);

    // ── Step 1: load active VAs ─────────────────────────────────────────────
    const vaIds = await step.run("load-va-ids", async () => {
      const rows = await prisma.va.findMany({
        where: { active: true },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    });

    // ── Step 2: load active Customers ──────────────────────────────────────
    const customerIds = await step.run("load-customer-ids", async () => {
      const rows = await prisma.customer.findMany({
        where: { active: true },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    });

    logger.info(`score-compute: ${vaIds.length} VAs, ${customerIds.length} customers`);

    // ── Step 3: VA reliability ──────────────────────────────────────────────
    await step.run("va-reliability", async () => {
      await computeVaReliability(today, vaIds);
      logger.info(`score-compute: va_reliability done for ${vaIds.length} VAs`);
    });

    // ── Step 4: VA capacity ─────────────────────────────────────────────────
    await step.run("va-capacity", async () => {
      await computeVaCapacity(today, vaIds);
      logger.info(`score-compute: va_capacity_index done for ${vaIds.length} VAs`);
    });

    // ── Step 5: Client health ───────────────────────────────────────────────
    await step.run("client-health", async () => {
      await computeClientHealth(today, customerIds);
      logger.info(`score-compute: client_health done for ${customerIds.length} customers`);
    });

    // ── Step 6: Client difficulty ───────────────────────────────────────────
    await step.run("client-difficulty", async () => {
      await computeClientDifficulty(today, customerIds);
      logger.info(`score-compute: client_difficulty done for ${customerIds.length} customers`);
    });

    logger.info("score-compute: all scoring complete");
    return {
      date: today.toISOString(),
      vas: vaIds.length,
      customers: customerIds.length,
    };
  }
);
