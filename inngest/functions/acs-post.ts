/**
 * inngest/functions/acs-post.ts
 *
 * ACS Phase 2 — Post approved completion reports to Basecamp.
 *
 * Scans TaskCompletionReport rows with status="approved" and posts the
 * approved_report as a formatted HTML comment on the Basecamp thread.
 * Updates status to "posted" on success, "failed" on error.
 *
 * Port of post_completion_report() + _format_for_basecamp() in
 * app/completion_report.py.
 *
 * Cron: every 15 minutes Mon–Fri
 * Event: tb/acs-post.requested
 *
 * Env:
 *   ACS_POST_MAX_PER_RUN  – max reports to post per run (default 10)
 *   BASECAMP_TOKEN         – service token for Basecamp API
 */

import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { postComment } from "@/lib/basecamp";

const MAX_PER_RUN = parseInt(process.env.ACS_POST_MAX_PER_RUN ?? "10");

// ── HTML formatter (port of _format_for_basecamp) ─────────────────────────

interface CompletionReportShape {
  what_was_done?: unknown;
  where_to_find_it?: unknown;
  quality_checks?: unknown;
  next_steps?: unknown;
  blockers?: unknown;
}

function toStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim());
}

function liList(items: string[]): string {
  if (!items.length) return "";
  return "<ul>" + items.map((i) => `<li>${i}</li>`).join("") + "</ul>";
}

function formatForBasecamp(report: CompletionReportShape): string {
  const parts: string[] = [];

  // ✅ Completed (what_was_done + quality_checks blended)
  const doneBullets = toStringArray(report.what_was_done);
  const qcBullets   = toStringArray(report.quality_checks);
  const allDone     = [...doneBullets, ...qcBullets];

  parts.push("<p>\u2705 <strong>Completed</strong></p>");
  const bulletHtml = liList(allDone);
  if (bulletHtml) parts.push(bulletHtml);

  // 📍 Where to find it
  const location =
    typeof report.where_to_find_it === "string"
      ? report.where_to_find_it.trim()
      : "";
  if (location) {
    parts.push(
      `<p>\ud83d\udccd <strong>Where to find it</strong><br>${location}</p>`
    );
  }

  // ➡️ Next steps
  const nextSteps = toStringArray(report.next_steps);
  const nsHtml = liList(nextSteps);
  if (nsHtml) {
    parts.push("<p>\u27a1\ufe0f <strong>Next steps</strong></p>");
    parts.push(nsHtml);
  }

  // ⛔ Blockers
  const blockers = toStringArray(report.blockers);
  const blHtml = liList(blockers);
  if (blHtml) {
    parts.push("<p>\u26d4 <strong>Blockers</strong></p>");
    parts.push(blHtml);
  }

  return parts.join("\n");
}

// ── Inngest function ────────────────────────────────────────────────────────

export const acsPost = inngest.createFunction(
  {
    id: "acs-post",
    name: "ACS Post Completion Reports",
    concurrency: { limit: 1 },
  },
  [
    { cron: "*/15 * * * 1-5" },
    { event: "tb/acs-post.requested" },
  ],
  async ({ step, logger }) => {
    // Step 1: find approved reports not yet posted
    const approved = await step.run("find-approved-reports", async () => {
      return prisma.taskCompletionReport.findMany({
        where: { status: "approved" },
        select: {
          id: true,
          basecamp_thread_id: true,
          approved_report: true,
          task_type: true,
        },
        orderBy: { updated_at: "asc" },
        take: MAX_PER_RUN,
      });
    });

    if (!approved.length) {
      logger.info("acs-post: no approved reports pending");
      return { posted: 0, failed: 0 };
    }

    logger.info(`acs-post: ${approved.length} approved reports to post`);

    let posted = 0;
    let failed = 0;

    for (const report of approved) {
      const result = await step.run(`post-${report.id}`, async () => {
        try {
          // Look up project_id from BasecampTodo
          const todo = await prisma.basecampTodo.findUnique({
            where: { basecamp_todo_id: report.basecamp_thread_id },
            select: { basecamp_project_id: true },
          });

          if (!todo?.basecamp_project_id) {
            await prisma.taskCompletionReport.update({
              where: { id: report.id },
              data: {
                status: "failed",
                error: "todo_or_project_id_missing",
                updated_at: new Date(),
              },
            });
            return { action: "failed" as const, reason: "todo_or_project_id_missing" };
          }

          const projectId = parseInt(todo.basecamp_project_id, 10);
          const todoId    = parseInt(report.basecamp_thread_id, 10);

          if (isNaN(projectId) || isNaN(todoId)) {
            await prisma.taskCompletionReport.update({
              where: { id: report.id },
              data: {
                status: "failed",
                error: "invalid_id_format",
                updated_at: new Date(),
              },
            });
            return { action: "failed" as const, reason: "invalid_id_format" };
          }

          const approvedReport = report.approved_report as CompletionReportShape;
          const content = formatForBasecamp(approvedReport);

          if (!content.trim()) {
            await prisma.taskCompletionReport.update({
              where: { id: report.id },
              data: {
                status: "failed",
                error: "formatted_content_empty",
                updated_at: new Date(),
              },
            });
            return { action: "failed" as const, reason: "formatted_content_empty" };
          }

          const comment = await postComment(projectId, todoId, content);
          const commentId = comment?.id ? String(comment.id) : null;

          await prisma.taskCompletionReport.update({
            where: { id: report.id },
            data: {
              status: "posted",
              posted_at: new Date(),
              basecamp_post_id: commentId,
              error: null,
              updated_at: new Date(),
            },
          });

          return { action: "posted" as const, commentId };
        } catch (err) {
          const msg = String(err).slice(0, 500);
          await prisma.taskCompletionReport
            .update({
              where: { id: report.id },
              data: { status: "failed", error: msg, updated_at: new Date() },
            })
            .catch(() => undefined);
          return { action: "failed" as const, reason: msg };
        }
      });

      if (result.action === "posted") {
        posted++;
      } else {
        failed++;
        logger.error(`acs-post: failed report ${report.id}: ${result.reason}`);
      }
    }

    logger.info(`acs-post: done. posted=${posted} failed=${failed}`);
    return { posted, failed };
  }
);
