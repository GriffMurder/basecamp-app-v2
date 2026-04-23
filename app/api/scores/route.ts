/**
 * GET /api/scores — latest ScoreDaily for all VAs and clients
 * Query params:
 *   type: va_reliability | client_health | client_difficulty | capacity_index (default: all)
 *   days: lookback window in days (default: 30)
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await requireAuth();
  const url = new URL(req.url);
  const type = url.searchParams.get("type"); // optional filter
  const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get("days") ?? "30")));

  const since = new Date();
  since.setDate(since.getDate() - days);

  const where: Record<string, unknown> = { day: { gte: since } };
  if (type) where.score_type = type;

  // Get all score rows in window
  const rows = await prisma.scoreDaily.findMany({
    where,
    orderBy: { day: "desc" },
    select: {
      id: true,
      day: true,
      score_type: true,
      score_value: true,
      trend_value: true,
      band: true,
      flags: true,
      customer_id: true,
      person_id: true,
    },
    take: 2000,
  });

  // Latest score per (person_id OR customer_id, score_type)
  const latestMap: Record<string, (typeof rows)[0]> = {};
  for (const row of rows) {
    const subjectKey = row.person_id ? `p:${row.person_id}` : `c:${row.customer_id}`;
    const key = `${subjectKey}:${row.score_type}`;
    if (!latestMap[key]) latestMap[key] = row; // already sorted desc by day
  }
  const latest = Object.values(latestMap);

  // Enrich VA-linked scores
  const personIds = [...new Set(latest.filter((r) => r.person_id).map((r) => r.person_id as number))];
  const customerIds = [...new Set(latest.filter((r) => r.customer_id).map((r) => r.customer_id as number))];

  const [vas, customers] = await Promise.all([
    personIds.length
      ? prisma.va.findMany({
          where: { id: { in: personIds } },
          select: { id: true, display_name: true, email: true, active: true },
        })
      : [],
    customerIds.length
      ? prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, name: true },
        })
      : [],
  ]);

  const vaMap = Object.fromEntries(vas.map((v) => [v.id, v]));
  const customerMap = Object.fromEntries(customers.map((c) => [c.id, c]));

  const enriched = latest.map((row) => ({
    ...row,
    score_value: Number(row.score_value),
    trend_value: row.trend_value != null ? Number(row.trend_value) : null,
    va: row.person_id ? vaMap[row.person_id] ?? null : null,
    customer: row.customer_id ? customerMap[row.customer_id] ?? null : null,
  }));

  return NextResponse.json({ ok: true, scores: enriched, count: enriched.length });
}
