/**
 * GET /api/acs-metrics — ACS Phase 6 metrics
 *
 * Returns post rate, time-to-post, edits before approval, and blocker frequency,
 * both aggregate and broken down by task_type.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pct(numerator: number | null, denominator: number): number | null {
  if (!denominator) return null;
  return Math.round((1000 * (numerator ?? 0)) / denominator) / 10;
}

export async function GET() {
  await requireAuth();

  const rows = await prisma.$queryRaw<
    {
      task_type: string;
      total: bigint;
      posted: bigint;
      avg_hours_to_post: number | null;
      median_hours_to_post: number | null;
      avg_edits_before_approval: number | null;
      reports_with_blockers: bigint;
    }[]
  >`
    SELECT
      task_type,
      COUNT(*)                                                              AS total,
      COUNT(*) FILTER (WHERE status = 'posted')                             AS posted,
      ROUND(
        AVG(
          EXTRACT(EPOCH FROM (posted_at - completed_at)) / 3600.0
        ) FILTER (WHERE posted_at IS NOT NULL AND completed_at IS NOT NULL)
      ::numeric, 2)                                                         AS avg_hours_to_post,
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (posted_at - completed_at)) / 3600.0
      ) FILTER (WHERE posted_at IS NOT NULL AND completed_at IS NOT NULL)   AS median_hours_to_post,
      ROUND(
        AVG(edit_count) FILTER (WHERE status IN ('approved', 'posted'))
      ::numeric, 2)                                                         AS avg_edits_before_approval,
      COUNT(*) FILTER (
        WHERE approved_report IS NOT NULL
          AND jsonb_array_length(
                COALESCE(approved_report->'blockers', '[]'::jsonb)
              ) > 0
      )                                                                     AS reports_with_blockers
    FROM task_completion_reports
    GROUP BY task_type
    ORDER BY task_type
  `;

  const breakdown = rows.map((r) => ({
    task_type: r.task_type,
    total: Number(r.total),
    posted: Number(r.posted),
    post_rate_pct: pct(Number(r.posted), Number(r.total)),
    avg_hours_to_post: r.avg_hours_to_post != null ? Number(r.avg_hours_to_post) : null,
    median_hours_to_post: r.median_hours_to_post != null ? Number(r.median_hours_to_post) : null,
    avg_edits_before_approval:
      r.avg_edits_before_approval != null ? Number(r.avg_edits_before_approval) : null,
    reports_with_blockers: Number(r.reports_with_blockers),
    blocker_frequency_pct: pct(Number(r.reports_with_blockers), Number(r.total)),
  }));

  // Aggregate totals across all task types
  const totalReports = breakdown.reduce((s, r) => s + r.total, 0);
  const totalPosted = breakdown.reduce((s, r) => s + r.posted, 0);
  const totalBlockers = breakdown.reduce((s, r) => s + r.reports_with_blockers, 0);

  return NextResponse.json({
    ok: true,
    summary: {
      total_reports: totalReports,
      total_posted: totalPosted,
      post_rate_pct: pct(totalPosted, totalReports),
      total_with_blockers: totalBlockers,
      blocker_frequency_pct: pct(totalBlockers, totalReports),
    },
    breakdown,
  });
}
