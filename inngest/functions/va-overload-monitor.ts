/**
 * inngest/functions/va-overload-monitor.ts
 *
 * Port of app/va_overload_monitor.py
 *
 * Computes throttle_level and burnout_flag for each active VA, then
 * upserts va_load_state rows used by the assignment engine and Team Health UI.
 *
 * Thresholds:
 *   WIP_SOFT_LIMIT = 6   → soft_throttle
 *   WIP_HARD_LIMIT = 10  → hard_throttle
 *
 * Quality dip thresholds (from VaPerformanceSnapshot.metrics_json):
 *   revision_rate       >= 0.25 absolute OR 20% jump over prior period
 *   negative_feedback_rate >= 0.10 absolute
 *   avg_turnaround_hours   30% jump over prior period
 *
 * Burnout flag:
 *   hard_throttle  OR  (quality_dip AND soft/hard_throttle)  OR  dip persists 2 periods
 *
 * Active task count: task_ownership.active rows per VA
 *
 * Cron: hourly
 * Also fires on: tb/va-overload-monitor.requested
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { vaUuid } from "@/lib/uuid5";

const WIP_SOFT_LIMIT = 6;
const WIP_HARD_LIMIT = 10;

const REVISION_RATE_ABSOLUTE = 0.25;
const REVISION_RATE_BUMP     = 0.20;
const NEGATIVE_FB_THRESHOLD  = 0.10;
const TURNAROUND_BUMP        = 0.30;

// ── Quality dip detection ────────────────────────────────────────────────────

function detectQualityDips(
  current: Record<string, unknown>,
  prior: Record<string, unknown>
): Record<string, string> {
  const dips: Record<string, string> = {};

  const currRevision   = Number(current.revision_rate ?? 0);
  const priorRevision  = Number(prior.revision_rate  ?? 0);

  if (currRevision >= REVISION_RATE_ABSOLUTE) {
    dips.high_revision_absolute = `Revision rate ${(currRevision * 100).toFixed(0)}% >= ${(REVISION_RATE_ABSOLUTE * 100).toFixed(0)}% absolute`;
  } else if (priorRevision > 0 && (currRevision - priorRevision) / priorRevision >= REVISION_RATE_BUMP) {
    dips.high_revision_bump = `Revision rate up ${(((currRevision - priorRevision) / priorRevision) * 100).toFixed(0)}% from ${(priorRevision * 100).toFixed(1)}% to ${(currRevision * 100).toFixed(1)}%`;
  }

  const currNeg = Number(current.negative_feedback_rate ?? 0);
  if (currNeg >= NEGATIVE_FB_THRESHOLD) {
    dips.negative_feedback = `Negative feedback rate ${(currNeg * 100).toFixed(0)}% >= ${(NEGATIVE_FB_THRESHOLD * 100).toFixed(0)}% threshold`;
  }

  const currTurnaround  = current.avg_turnaround_hours != null ? Number(current.avg_turnaround_hours) : null;
  const priorTurnaround = prior.avg_turnaround_hours  != null ? Number(prior.avg_turnaround_hours)  : null;

  if (
    currTurnaround  != null &&
    priorTurnaround != null &&
    priorTurnaround > 0 &&
    (currTurnaround - priorTurnaround) / priorTurnaround >= TURNAROUND_BUMP
  ) {
    dips.turnaround_slowdown = `Avg turnaround up ${(((currTurnaround - priorTurnaround) / priorTurnaround) * 100).toFixed(0)}% from ${priorTurnaround.toFixed(1)}h to ${currTurnaround.toFixed(1)}h`;
  }

  return dips;
}

// ── Main assessment ───────────────────────────────────────────────────────────

interface LoadAssessment {
  throttleLevel:   "normal" | "soft_throttle" | "hard_throttle";
  burnoutFlag:     boolean;
  reasons:         string[];
  activeTaskCount: number;
}

async function assessVaLoadState(vaId: number): Promise<LoadAssessment> {
  const vaUuidStr = vaUuid(vaId);

  // Live active task count from task_ownership
  const activeTasks = await prisma.taskOwnership.count({
    where: { responsible_va_id: vaId, active: true },
  });

  // Recent performance snapshots
  const snapshots = await prisma.vaPerformanceSnapshot.findMany({
    where: { va_id: vaUuidStr },
    orderBy: { period_end: "desc" },
    take: 3,
    select: { metrics_json: true, period_end: true },
  });

  const [current, prior, twoBack] = snapshots;

  // Throttle level from active task count
  let throttleLevel: "normal" | "soft_throttle" | "hard_throttle";
  if (activeTasks >= WIP_HARD_LIMIT) {
    throttleLevel = "hard_throttle";
  } else if (activeTasks >= WIP_SOFT_LIMIT) {
    throttleLevel = "soft_throttle";
  } else {
    throttleLevel = "normal";
  }

  const reasons: string[] = [];
  if (throttleLevel !== "normal") {
    reasons.push(`Active tasks ${activeTasks} exceeds limit ${WIP_SOFT_LIMIT}/${WIP_HARD_LIMIT}`);
  }

  // Quality dip detection (requires at least 2 snapshots)
  let qualityDips: Record<string, string> = {};
  let dipPersistsTwoPeriods = false;

  if (current && prior) {
    const currentMetrics = (current.metrics_json as Record<string, unknown>) ?? {};
    const priorMetrics   = (prior.metrics_json   as Record<string, unknown>) ?? {};

    qualityDips = detectQualityDips(currentMetrics, priorMetrics);
    reasons.push(...Object.values(qualityDips));

    // Persistence check: same dip in prior vs two-back?
    if (twoBack && Object.keys(qualityDips).length > 0) {
      const twoBackMetrics = (twoBack.metrics_json as Record<string, unknown>) ?? {};
      const dipsInPrior    = detectQualityDips(priorMetrics, twoBackMetrics);
      for (const dipType of Object.keys(qualityDips)) {
        if (dipType in dipsInPrior) {
          dipPersistsTwoPeriods = true;
          reasons.push(`${dipType} persists across periods`);
          break;
        }
      }
    }
  }

  // Burnout flag
  const hasOverload    = throttleLevel !== "normal";
  const hasQualityDip  = Object.keys(qualityDips).length > 0;

  const burnoutFlag =
    throttleLevel === "hard_throttle" ||
    (hasQualityDip && hasOverload)     ||
    dipPersistsTwoPeriods;

  if (burnoutFlag && throttleLevel !== "hard_throttle") {
    if (dipPersistsTwoPeriods) {
      reasons.push("Burnout flag: quality dips persist across 2+ periods");
    } else if (hasQualityDip && hasOverload) {
      reasons.push("Burnout flag: quality decline + workload overload");
    }
  }

  return { throttleLevel, burnoutFlag, reasons, activeTaskCount: activeTasks };
}

// ── Inngest function ──────────────────────────────────────────────────────────

export const vaOverloadMonitor = inngest.createFunction(
  {
    id: "va-overload-monitor",
    name: "VA Overload Monitor",
    concurrency: { limit: 1 },
  },
  [
    { cron: "0 * * * *" }, // Hourly
    { event: "tb/va-overload-monitor.requested" },
  ],
  async ({ step, logger }) => {
    const vas = await step.run("load-vas", async () => {
      return prisma.va.findMany({
        where: { active: true },
        select: { id: true, display_name: true },
        orderBy: { id: "asc" },
      });
    });

    if (!vas.length) {
      logger.info("va-overload-monitor: no active VAs");
      return { assessed: 0 };
    }

    logger.info(`va-overload-monitor: assessing ${vas.length} VAs`);

    let assessed = 0;
    let burnoutFlagged = 0;
    let throttled = 0;
    let errors = 0;

    for (const va of vas) {
      await step.run(`assess-va-${va.id}`, async () => {
        try {
          const state = await assessVaLoadState(va.id);
          const vaUuidStr = vaUuid(va.id);

          await prisma.vaLoadState.upsert({
            where: { va_id: vaUuidStr },
            update: {
              active_task_count: state.activeTaskCount,
              throttle_level:    state.throttleLevel,
              burnout_flag:      state.burnoutFlag,
              reasons_json:      state.reasons,
              updated_at:        new Date(),
            },
            create: {
              va_id:             vaUuidStr,
              active_task_count: state.activeTaskCount,
              throttle_level:    state.throttleLevel,
              burnout_flag:      state.burnoutFlag,
              reasons_json:      state.reasons,
            },
          });

          assessed++;
          if (state.burnoutFlag)             burnoutFlagged++;
          if (state.throttleLevel !== "normal") throttled++;

          if (state.throttleLevel !== "normal" || state.burnoutFlag) {
            logger.warn(
              `va-overload-monitor: VA ${va.display_name ?? va.id} — ` +
              `${state.throttleLevel}, burnout=${state.burnoutFlag}, ` +
              `tasks=${state.activeTaskCount}`
            );
          }
        } catch (err) {
          logger.error(`va-overload-monitor: error for VA ${va.id}: ${err}`);
          errors++;
        }
      });
    }

    logger.info(
      `va-overload-monitor done: assessed=${assessed} burnout=${burnoutFlagged} ` +
      `throttled=${throttled} errors=${errors}`
    );

    return { assessed, burnoutFlagged, throttled, errors };
  }
);
