/**
 * app/api/admin/noise-budget/route.ts
 * GET /api/admin/noise-budget
 *
 * Returns the current in-memory noise budget counters for all tracked
 * Slack channels. Useful for ops visibility and debugging.
 *
 * Note: counts are per-instance in-memory state (same as Python app).
 * A serverless cold start will show zero counts even if posts went out
 * in a prior instance.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getAllCounts } from "@/lib/noise-budget";

export async function GET() {
  await requireAdmin();
  const counts = getAllCounts();
  return NextResponse.json({
    ok: true,
    date: new Date().toISOString().slice(0, 10),
    channels: counts,
    total_channels: Object.keys(counts).length,
  });
}