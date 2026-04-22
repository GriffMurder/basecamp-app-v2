/**
 * GET /api/insights/ops-daily
 * Structured ops snapshot for daily stand-up / AI digest.
 * Mirrors app/routes/insights.py :: insights_ops_daily()
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  await requireAuth();

  const url = new URL(req.url);
  const topN = Math.min(50, Math.max(1, parseInt(url.searchParams.get("top_n") ?? "10")));
  const slaHours = parseInt(url.searchParams.get("escalation_sla_hours") ?? "48");
  const now = new Date();
  const slaThreshold = new Date(now.getTime() - slaHours * 3600_000);

  // ── At-risk clients (lowest health score) ─────────────────────────────
  const atRiskClients = await prisma.customer.findMany({
    where: { active: true, client_health_score: { not: null } },
    orderBy: { client_health_score: "asc" },
    take: topN,
    select: { id: true, name: true, client_health_score: true, effective_tier: true },
  });

  // ── Open manager escalations ───────────────────────────────────────────
  const openEscalations = await prisma.intervention.findMany({
    where: { status: "open" },
    select: {
      id: true, level: true, reason: true, target_person_id: true,
      customer_id: true, todo_id: true, created_at: true, sla_due_at: true,
    },
    orderBy: { created_at: "asc" },
    take: 200,
  });

  const escalationsWithAge = openEscalations.map((e) => {
    const ageDays = (now.getTime() - e.created_at.getTime()) / 86400_000;
    const slaBreached = e.sla_due_at ? now > e.sla_due_at : ageDays > slaHours / 24;
    return { ...e, age_days: Math.round(ageDays * 10) / 10, sla_breached: slaBreached };
  });

  // ── Active VAs ────────────────────────────────────────────────────────
  const vas = await prisma.va.findMany({
    where: { active: true },
    select: {
      id: true, display_name: true, reliability_score: true,
      capacity_index: true, last_scored_at: true,
    },
    orderBy: { reliability_score: "asc" },
    take: topN,
  });

  // ── Burnout risk (VAs with high capacity_index) ────────────────────────
  const burnoutRisk = await prisma.va.findMany({
    where: { active: true, capacity_index: { gte: 80 } },
    select: { id: true, display_name: true, capacity_index: true, reliability_score: true },
    orderBy: { capacity_index: "desc" },
    take: topN,
  });

  // ── Open todos past SLA ────────────────────────────────────────────────
  const overdueTodos = await prisma.basecampTodo.count({
    where: { completed: false, due_on: { lt: now } },
  });

  return NextResponse.json({
    ok: true,
    generated_at: now.toISOString(),
    at_risk_clients: atRiskClients,
    open_manager_escalations: {
      total: openEscalations.length,
      sla_breached: escalationsWithAge.filter((e) => e.sla_breached).length,
      items: escalationsWithAge.slice(0, topN),
    },
    vas_trending_down: vas,
    burnout_risk: burnoutRisk,
    overdue_todos: overdueTodos,
  });
}