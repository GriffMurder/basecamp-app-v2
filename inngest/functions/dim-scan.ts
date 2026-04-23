/**
 * DIM (Data Integrity Monitor) — Nightly scan
 *
 * Detects lifecycle anomalies in Basecamp todos:
 *   STUCK_IN_CREATED            — todo replied on but lifecycle still CREATED (> 6h)
 *   STALE_IN_PROGRESS           — lifecycle IN_PROGRESS, no update > 24h
 *   PM_COMPLETED_BUT_LIFECYCLE_OPEN — Basecamp marked complete but lifecycle not closing
 *   ORPHAN_ASSIGNMENT           — task completed but ownership still active (via AiTask)
 *
 * Findings are upserted to task_integrity_findings table, then a Block Kit
 * summary is posted to OPS_CHANNEL_ID or DIM_CHANNEL_ID.
 */
import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { postToOps } from "@/lib/slack";

export const dimScan = inngest.createFunction(
  {
    id: "dim-nightly-scan",
    name: "DIM: Nightly Integrity Scan",
    concurrency: { limit: 1 },
  },
  [{ cron: "0 2 * * *" }, { event: "dim/scan.requested" }],
  async ({ step }) => {
    const enabled = process.env.DIM_ENABLED === "true";
    if (!enabled) {
      return { skipped: true, reason: "DIM_ENABLED not set" };
    }

    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // ── 1. STUCK_IN_CREATED ─────────────────────────────────────────────────
    const stuckCreated = await step.run("find-stuck-in-created", async () => {
      return prisma.basecampTodo.findMany({
        where: {
          completed: false,
          lifecycle_state: "CREATED",
          updated_at: { lt: sixHoursAgo },
        },
        select: { id: true, title: true, updated_at: true },
        take: 100,
      });
    });

    // ── 2. STALE_IN_PROGRESS ────────────────────────────────────────────────
    const staleInProgress = await step.run("find-stale-in-progress", async () => {
      return prisma.basecampTodo.findMany({
        where: {
          completed: false,
          lifecycle_state: "IN_PROGRESS",
          updated_at: { lt: twentyFourHoursAgo },
        },
        select: { id: true, title: true, updated_at: true },
        take: 100,
      });
    });

    // ── 3. PM_COMPLETED_BUT_LIFECYCLE_OPEN ──────────────────────────────────
    const pmCompletedOpen = await step.run("find-pm-completed-open", async () => {
      return prisma.basecampTodo.findMany({
        where: {
          completed: true,
          lifecycle_state: {
            not: "COMPLETION_SIGNAL_DETECTED",
          },
        },
        select: { id: true, title: true, lifecycle_state: true, updated_at: true },
        take: 100,
      });
    });

    // ── 4. ORPHAN_ASSIGNMENT ────────────────────────────────────────────────
    // AiTask with status=completed but the linked todo's lifecycle is still open
    const orphanAssignments = await step.run("find-orphan-assignments", async () => {
      // AiTask links via basecamp_todo_id (string) to BasecampTodo.basecamp_todo_id
      const completedAiTasks = await prisma.aiTask.findMany({
        where: { status: "completed" },
        select: { id: true, basecamp_todo_id: true, title: true, updated_at: true },
        take: 200,
      });
      if (completedAiTasks.length === 0) return [];

      const bcTodoIds = completedAiTasks.map((t) => t.basecamp_todo_id);
      const openTodos = await prisma.basecampTodo.findMany({
        where: {
          basecamp_todo_id: { in: bcTodoIds },
          completed: false,
          lifecycle_state: { notIn: ["COMPLETION_SIGNAL_DETECTED", "DONE"] },
        },
        select: { id: true, basecamp_todo_id: true },
      });

      const openSet = new Map(openTodos.map((t) => [t.basecamp_todo_id, t.id]));
      return completedAiTasks
        .filter((t) => openSet.has(t.basecamp_todo_id ?? ""))
        .map((t) => ({ ...t, dbTodoId: openSet.get(t.basecamp_todo_id ?? "") ?? 0 }));
    });

    // ── Upsert findings ─────────────────────────────────────────────────────
    const upsertFindings = await step.run("upsert-findings", async () => {
      type NewFinding = {
        todo_id: number;
        finding_type: string;
        detail: string | null;
        severity: string;
      };

      const findings: NewFinding[] = [
        ...stuckCreated.map((t) => ({
          todo_id: t.id,
          finding_type: "STUCK_IN_CREATED",
          detail: `Lifecycle CREATED since ${t.updated_at?.toString() ?? "?"}`,

          severity: "warning",
        })),
        ...staleInProgress.map((t) => ({
          todo_id: t.id,
          finding_type: "STALE_IN_PROGRESS",
          detail: `In progress but silent since ${t.updated_at?.toString() ?? "?"}`,
          severity: "critical",
        })),
        ...pmCompletedOpen.map((t) => ({
          todo_id: t.id,
          finding_type: "PM_COMPLETED_BUT_LIFECYCLE_OPEN",
          detail: `Basecamp completed=true but lifecycle is ${t.lifecycle_state ?? "open"}`,
          severity: "info",
        })),
        ...orphanAssignments.map((t) => ({
          todo_id: t.dbTodoId,
          finding_type: "ORPHAN_ASSIGNMENT",
          detail: `AiTask completed but todo lifecycle not closing`,
          severity: "warning",
        })),
      ];

      let created = 0;
      for (const f of findings) {
        await prisma.taskIntegrityFinding.upsert({
          where: {
            uq_finding_todo: {
              finding_type: f.finding_type,
              todo_id: f.todo_id,
            },
          },
          create: {
            todo_id: f.todo_id,
            finding_type: f.finding_type,
            detail: f.detail,
            severity: f.severity,
          },
          update: {
            detail: f.detail,
            severity: f.severity,
            resolved_at: null, // re-open if previously resolved
          },
        });
        created++;
      }
      return { upserted: created };
    });

    // ── Auto-resolve findings for now-completed todos ───────────────────────
    await step.run("auto-resolve-completed", async () => {
      const completedTodoIds = await prisma.basecampTodo.findMany({
        where: { completed: true },
        select: { id: true },
      });
      const ids = completedTodoIds.map((t) => t.id);
      if (ids.length === 0) return;
      await prisma.taskIntegrityFinding.updateMany({
        where: {
          todo_id: { in: ids },
          resolved_at: null,
          finding_type: { in: ["STUCK_IN_CREATED", "STALE_IN_PROGRESS", "ORPHAN_ASSIGNMENT"] },
        },
        data: { resolved_at: new Date() },
      });
    });

    // ── Post Slack summary ──────────────────────────────────────────────────
    const total =
      stuckCreated.length + staleInProgress.length + pmCompletedOpen.length + orphanAssignments.length;

    await step.run("post-slack-summary", async () => {
      if (total === 0) return;

      const lines = [
        `*🛡️ DIM Nightly Scan — ${now.toDateString()}*`,
        `Found *${total}* integrity issue(s):`,
        stuckCreated.length > 0 ? `  🟡 STUCK_IN_CREATED: ${stuckCreated.length}` : null,
        staleInProgress.length > 0 ? `  🔴 STALE_IN_PROGRESS: ${staleInProgress.length}` : null,
        pmCompletedOpen.length > 0 ? `  🔵 PM_COMPLETE_LIFECYCLE_OPEN: ${pmCompletedOpen.length}` : null,
        orphanAssignments.length > 0 ? `  🟡 ORPHAN_ASSIGNMENT: ${orphanAssignments.length}` : null,
      ].filter(Boolean).join("\n");

      await postToOps(lines);
    });

    return {
      ok: true,
      stuckCreated: stuckCreated.length,
      staleInProgress: staleInProgress.length,
      pmCompletedOpen: pmCompletedOpen.length,
      orphanAssignments: orphanAssignments.length,
      upserted: upsertFindings.upserted,
    };
  }
);
