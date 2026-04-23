/**
 * inngest/functions/tier-compute.ts
 *
 * Port of app/tier_compute.py
 *
 * Computes `auto_tier` (A/B/C) for every active customer based on a
 * 4-component weighted composite score, then sets `effective_tier`
 * (manual_tier takes precedence if set).
 *
 * Score weights:
 *   40 % — revenue proxy (open task count as stand-in)
 *   30 % — active task load
 *   20 % — escalation frequency (interventions last 30 days)
 *   10 % — communication density (interactions last 30 days)
 *
 * Tier thresholds:  >= 75 → A  |  50-74 → B  |  < 50 → C
 *
 * Cron: Mon-Fri 14:00 UTC (after score-compute at 13:07 UTC)
 * Also fires on: tb/tier-compute.requested
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";

const LOOKBACK_DAYS = 30;

const WEIGHTS = {
  revenue_proxy:  0.40,
  task_load:      0.30,
  escalation:     0.20,
  comms:          0.10,
};

const TIER_THRESHOLDS = { A: 75, B: 50 };

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
  for (const [k, v] of values)
    out.set(k, (100 * (v - lo)) / (hi - lo));
  return out;
}

function scoreToTier(score: number): string {
  if (score >= TIER_THRESHOLDS.A) return "A";
  if (score >= TIER_THRESHOLDS.B) return "B";
  return "C";
}

export const tierCompute = inngest.createFunction(
  {
    id: "tier-compute",
    name: "Customer Tier Auto-Compute",
    concurrency: { limit: 1 },
  },
  [
    { cron: "0 14 * * 1-5" }, // Mon-Fri 14:00 UTC
    { event: "tb/tier-compute.requested" },
  ],
  async ({ step, logger }) => {
    const now = new Date();
    const cutoff = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
    const cutoffIso = cutoff.toISOString();

    logger.info("tier-compute: loading active customers");

    const customers = await step.run("load-customers", async () => {
      return prisma.customer.findMany({
        where: { active: true },
        select: { id: true, basecamp_project_id: true, manual_tier: true },
      });
    });

    if (!customers.length) {
      logger.info("tier-compute: no active customers, skipping");
      return { updated: 0 };
    }

    const customerIds = customers.map((c) => c.id);
    const manualTierMap = new Map(
      customers
        .filter((c) => c.manual_tier)
        .map((c) => [c.id, c.manual_tier as string])
    );

    logger.info(`tier-compute: computing tiers for ${customerIds.length} customers`);

    // ── Collect raw component values ────────────────────────────────────────

    const [revRows, taskRows, escRows, commsRows] = await step.run(
      "fetch-raw-data",
      async () => {
        const [revRows, taskRows, escRows, commsRows] = await Promise.all([
          // Revenue proxy: open basecamp todos per customer
          prisma.$queryRawUnsafe<Array<{ customer_id: number; cnt: number }>>(
            `SELECT c.id AS customer_id, COUNT(t.id) AS cnt
             FROM customers c
             LEFT JOIN basecamp_todos t
                    ON t.basecamp_project_id = c.basecamp_project_id
                   AND t.completed = FALSE
             WHERE c.id = ANY($1::int[])
               AND c.basecamp_project_id IS NOT NULL
             GROUP BY c.id`,
            customerIds
          ),
          // Task load: open todos total (including those without project match)
          prisma.$queryRawUnsafe<Array<{ customer_id: number; cnt: number }>>(
            `SELECT c.id AS customer_id, COUNT(t.id) AS cnt
             FROM customers c
             LEFT JOIN basecamp_todos t
                    ON t.basecamp_project_id = c.basecamp_project_id
                   AND t.completed = FALSE
             WHERE c.id = ANY($1::int[])
             GROUP BY c.id`,
            customerIds
          ),
          // Escalations: intervention count in lookback
          prisma.$queryRawUnsafe<Array<{ customer_id: number; cnt: number }>>(
            `SELECT customer_id, COUNT(*) AS cnt
             FROM interventions
             WHERE customer_id = ANY($1::int[])
               AND created_at >= $2
             GROUP BY customer_id`,
            customerIds,
            cutoffIso
          ),
          // Comms density: interaction count in lookback
          prisma.$queryRawUnsafe<Array<{ customer_id: number; cnt: number }>>(
            `SELECT customer_id, COUNT(*) AS cnt
             FROM interactions
             WHERE customer_id = ANY($1::int[])
               AND happened_at >= $2
             GROUP BY customer_id`,
            customerIds,
            cutoffIso
          ),
        ]);
        return [revRows, taskRows, escRows, commsRows];
      }
    );

    // ── Build component maps ────────────────────────────────────────────────

    const revMap     = new Map<number, number>();
    const taskMap    = new Map<number, number>();
    const escMap     = new Map<number, number>();
    const commsMap   = new Map<number, number>();

    for (const r of revRows)   revMap.set(r.customer_id,   Number(r.cnt));
    for (const r of taskRows)  taskMap.set(r.customer_id,  Number(r.cnt));
    for (const r of escRows)   escMap.set(r.customer_id,   Number(r.cnt));
    for (const r of commsRows) commsMap.set(r.customer_id, Number(r.cnt));

    // Fill missing with 0
    for (const id of customerIds) {
      revMap.set(id, revMap.get(id) ?? 0);
      taskMap.set(id, taskMap.get(id) ?? 0);
      escMap.set(id, escMap.get(id) ?? 0);
      commsMap.set(id, commsMap.get(id) ?? 0);
    }

    // ── Normalise ───────────────────────────────────────────────────────────

    const revN   = minmax(revMap);    // higher open count = higher usage = higher score
    const taskN  = minmax(taskMap);   // higher task load = higher value/usage
    const escN   = minmax(escMap);    // higher escalations = more engagement (positive for revenue proxy)
    const commsN = minmax(commsMap);  // higher comms = more engaged = higher tier

    // ── Compute tier scores & persist ──────────────────────────────────────

    const results = await step.run("compute-and-persist", async () => {
      let updated = 0;
      const summary: Array<{ id: number; score: number; tier: string }> = [];

      for (const id of customerIds) {
        const score = Math.round(
          WEIGHTS.revenue_proxy * (revN.get(id) ?? 50) +
          WEIGHTS.task_load     * (taskN.get(id) ?? 50) +
          WEIGHTS.escalation    * (escN.get(id) ?? 50) +
          WEIGHTS.comms         * (commsN.get(id) ?? 50)
        );

        const autoTier = scoreToTier(score);
        const effectiveTier = manualTierMap.get(id) ?? autoTier;

        // Upsert Tier row
        await prisma.tier.upsert({
          where: { customer_id: id },
          update: {
            auto_tier: autoTier,
            auto_tier_computed_at: now,
            effective_tier: effectiveTier,
            computed_at: now,
            updated_at: now,
          },
          create: {
            customer_id: id,
            auto_tier: autoTier,
            auto_tier_computed_at: now,
            effective_tier: effectiveTier,
            computed_at: now,
            updated_at: now,
          },
        });

        // Keep Customer.effective_tier in sync
        await prisma.customer.update({
          where: { id },
          data: { effective_tier: effectiveTier, tier_computed_at: now },
        });

        updated++;
        summary.push({ id, score, tier: autoTier });
      }

      return { updated, summary };
    });

    logger.info(
      `tier-compute: updated ${results.updated} tiers — ` +
      `A:${results.summary.filter((r) => r.tier === "A").length} ` +
      `B:${results.summary.filter((r) => r.tier === "B").length} ` +
      `C:${results.summary.filter((r) => r.tier === "C").length}`
    );

    return results;
  }
);
