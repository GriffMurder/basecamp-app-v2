/**
 * inngest/functions/va-snapshot.ts
 *
 * Port of app/va_snapshot_builder.py
 *
 * Computes daily performance snapshots for each active VA and upserts rows
 * into va_performance_snapshots.
 *
 * metrics_json contract (v1):
 *   tasks_completed        – todos completed by this VA in the period
 *   avg_turnaround_hours   – mean assigned_at → completed_at hours
 *   revision_rate          – REVISION_REQUESTED events / tasks_completed
 *   negative_feedback_rate – NEGATIVE_FEEDBACK events / tasks_completed
 *   praise_rate            – PRAISE_SIGNAL events / tasks_completed
 *   after_hours_work       – fraction of interactions outside CT 09-17 M-F
 *   task_type_mix          – {task_type: count, ...}
 *
 * Crons:
 *   Daily   03:00 UTC  → last 24 h period
 *   Weekly  Mon 08:15 UTC → last 7 days
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";

// NAMESPACE_OID — matches Python uuid.NAMESPACE_OID
const NAMESPACE_OID = "6ba7b812-9dad-11d1-80b4-00c04fd430c8";

/** Derive a stable UUID5 for a VA from its integer id (matches Python uuid.uuid5) */
function deriveVaUuid(vaId: number): string {
  const nsHex = NAMESPACE_OID.replace(/-/g, "");
  const nsBuf = Buffer.from(nsHex, "hex");
  const nameBuf = Buffer.from(`va:${vaId}`, "utf8");
  const combined = Buffer.concat([nsBuf, nameBuf]);
  const h = createHash("sha1").update(combined).digest("hex");
  // Apply version 5 (0101xxxx) and variant 10xx
  const p3 = ((parseInt(h.slice(12, 16), 16) & 0x0fff) | 0x5000).toString(16).padStart(4, "0");
  const p4 = ((parseInt(h.slice(16, 20), 16) & 0x3fff) | 0x8000).toString(16).padStart(4, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${p3}-${p4}-${h.slice(20, 32)}`;
}

function isCTBusinessHours(dt: Date): boolean {
  // America/Chicago offset: UTC-6 (CST) or UTC-5 (CDT)
  // Approximate: UTC-6 standard; during summer UTC-5
  const month = dt.getUTCMonth() + 1; // 1–12
  const isDST = month >= 3 && month <= 11; // rough approximation
  const offsetHours = isDST ? -5 : -6;
  const localHour = (dt.getUTCHours() + 24 + offsetHours) % 24;
  const dow = dt.getUTCDay(); // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) return false;
  return localHour >= 9 && localHour < 17;
}

export const vaSnapshotDaily = inngest.createFunction(
  {
    id: "va-snapshot-daily",
    name: "VA Snapshot — Daily",
    concurrency: { limit: 1 },
  },
  [
    { cron: "0 3 * * *" },
    { event: "tb/va-snapshot-daily.requested" },
  ],
  async ({ step, logger }) => {
    const now = new Date();
    const periodEnd = new Date(now.setHours(0, 0, 0, 0)); // start of today UTC
    const periodStart = new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000);

    return computeSnapshots({ step, logger, periodStart, periodEnd, label: "daily" });
  }
);

export const vaSnapshotWeekly = inngest.createFunction(
  {
    id: "va-snapshot-weekly",
    name: "VA Snapshot — Weekly",
    concurrency: { limit: 1 },
  },
  [
    { cron: "15 8 * * 1" }, // Mon 08:15 UTC
    { event: "tb/va-snapshot-weekly.requested" },
  ],
  async ({ step, logger }) => {
    const now = new Date();
    const periodEnd = new Date(now.setHours(0, 0, 0, 0));
    const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

    return computeSnapshots({ step, logger, periodStart, periodEnd, label: "weekly" });
  }
);

async function computeSnapshots({
  step,
  logger,
  periodStart,
  periodEnd,
  label,
}: {
  step: Parameters<Parameters<typeof inngest.createFunction>[2]>[0]["step"];
  logger: Parameters<Parameters<typeof inngest.createFunction>[2]>[0]["logger"];
  periodStart: Date;
  periodEnd: Date;
  label: string;
}) {
  // ── Load active VAs ──────────────────────────────────────────────────────
  const vas = await step.run("load-active-vas", async () => {
    return prisma.va.findMany({
      where: { active: true },
      select: { id: true, basecamp_person_id: true, display_name: true, slack_user_id: true },
    });
  });

  if (!vas.length) {
    logger.info(`va-snapshot-${label}: no active VAs`);
    return { skipped: true, reason: "no_active_vas" };
  }

  logger.info(`va-snapshot-${label}: computing for ${vas.length} VAs`, {
    periodStart,
    periodEnd,
  });

  let upserted = 0;
  let errors = 0;

  // ── Compute per-VA metrics ───────────────────────────────────────────────
  for (const va of vas) {
    const result = await step.run(`compute-va-${va.id}`, async () => {
      try {
        const bcPersonId = va.basecamp_person_id;

        // ── 1. Completed todos in period ─────────────────────────────────
        const completedTodos = await prisma.basecampTodo.findMany({
          where: {
            assignee_id: bcPersonId ?? undefined,
            completed: true,
            completed_at: { gte: periodStart, lt: periodEnd },
          },
          select: {
            id: true,
            basecamp_todo_id: true,
            assigned_at: true,
            completed_at: true,
            lifecycle_state: true,
          },
        });

        const tasksCompleted = completedTodos.length;

        // ── 2. Avg turnaround (hours: assigned_at → completed_at) ────────
        let avgTurnaroundHours = 0;
        if (tasksCompleted > 0) {
          const turnarounds = completedTodos
            .filter((t) => t.assigned_at && t.completed_at)
            .map((t) =>
              (t.completed_at!.getTime() - t.assigned_at!.getTime()) / (1000 * 60 * 60)
            );
          if (turnarounds.length > 0) {
            avgTurnaroundHours =
              Math.round((turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length) * 10) / 10;
          }
        }

        // ── 3. Quality events from Interaction table ─────────────────────
        // person_id column links Person table (not Va) — look up person record
        const personRecord = bcPersonId
          ? await prisma.person.findFirst({
              where: { basecamp_person_id: bcPersonId, role: "va" },
              select: { id: true },
            })
          : null;

        let revisionRate = 0;
        let negativeFeedbackRate = 0;
        let praiseRate = 0;
        let afterHoursWork = 0;

        if (personRecord) {
          const qualityInteractions = await prisma.interaction.findMany({
            where: {
              person_id: personRecord.id,
              happened_at: { gte: periodStart, lt: periodEnd },
              interaction_type: {
                in: ["REVISION_REQUESTED", "NEGATIVE_FEEDBACK", "PRAISE_SIGNAL"],
              },
            },
            select: { interaction_type: true, happened_at: true },
          });

          const revisionCount = qualityInteractions.filter(
            (i) => i.interaction_type === "REVISION_REQUESTED"
          ).length;
          const negCount = qualityInteractions.filter(
            (i) => i.interaction_type === "NEGATIVE_FEEDBACK"
          ).length;
          const praiseCount = qualityInteractions.filter(
            (i) => i.interaction_type === "PRAISE_SIGNAL"
          ).length;

          if (tasksCompleted > 0) {
            revisionRate = Math.round((revisionCount / tasksCompleted) * 1000) / 1000;
            negativeFeedbackRate = Math.round((negCount / tasksCompleted) * 1000) / 1000;
            praiseRate = Math.round((praiseCount / tasksCompleted) * 1000) / 1000;
          }

          // After-hours work: fraction of all interactions outside CT 09-17 M-F
          const allInteractions = await prisma.interaction.findMany({
            where: {
              person_id: personRecord.id,
              happened_at: { gte: periodStart, lt: periodEnd },
            },
            select: { happened_at: true },
          });

          if (allInteractions.length > 0) {
            const afterHoursCount = allInteractions.filter(
              (i) => !isCTBusinessHours(i.happened_at)
            ).length;
            afterHoursWork =
              Math.round((afterHoursCount / allInteractions.length) * 1000) / 1000;
          }
        }

        // ── 4. Task type mix ──────────────────────────────────────────────
        const taskTypeMix: Record<string, number> = {};
        for (const todo of completedTodos) {
          const state = todo.lifecycle_state ?? "unknown";
          taskTypeMix[state] = (taskTypeMix[state] ?? 0) + 1;
        }

        // ── 5. Upsert VaPerformanceSnapshot ──────────────────────────────
        const vaUuid = deriveVaUuid(va.id);
        const metricsJson = {
          tasks_completed: tasksCompleted,
          avg_turnaround_hours: avgTurnaroundHours,
          revision_rate: revisionRate,
          negative_feedback_rate: negativeFeedbackRate,
          praise_rate: praiseRate,
          after_hours_work: afterHoursWork,
          task_type_mix: taskTypeMix,
        };

        await prisma.vaPerformanceSnapshot.upsert({
          where: {
            va_perf_snap_unique: {
              va_id: vaUuid,
              period_start: periodStart,
              period_end: periodEnd,
            },
          },
          update: { metrics_json: metricsJson, updated_at: new Date() },
          create: {
            va_id: vaUuid,
            period_start: periodStart,
            period_end: periodEnd,
            metrics_json: metricsJson,
          },
        });

        return { ok: true, va_id: va.id, tasks_completed: tasksCompleted };
      } catch (err) {
        logger.error(`va-snapshot: failed for VA ${va.id}`, { err });
        return { ok: false, va_id: va.id, error: String(err) };
      }
    });

    if (result.ok) upserted++;
    else errors++;
  }

  return { label, upserted, errors, va_count: vas.length, periodStart, periodEnd };
}
