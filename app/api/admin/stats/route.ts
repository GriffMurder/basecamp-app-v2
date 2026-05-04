import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/stats
 *
 * Returns the live ops command-center KPIs as JSON.
 * Protected by the ADMIN_STATS_KEY env var — caller must send matching `x-admin-key` header.
 *
 * Used by Wesley's personal AI assistant to surface ops health in chat + morning briefing.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.ADMIN_STATS_KEY;
  if (!expected || expected.length < 32) {
    return NextResponse.json(
      { error: "ADMIN_STATS_KEY not configured on server" },
      { status: 503 }
    );
  }
  const provided = req.headers.get("x-admin-key");
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const [
      activeVas,
      totalClients,
      totalTodos,
      openTodos,
      overdueTodos,
      openInterventions,
      hoursTodayAgg,
    ] = await Promise.all([
      prisma.person.count({ where: { role: "va", active: true } }),
      prisma.customer.count({ where: { active: true } }),
      prisma.basecampTodo.count(),
      prisma.basecampTodo.count({ where: { completed: false } }),
      prisma.basecampTodo.count({
        where: { completed: false, due_on: { lt: now } },
      }),
      prisma.intervention.count({ where: { status: "open" } }),
      prisma.timeEntry.aggregate({
        where: { created_at: { gte: startOfToday } },
        _sum: { duration_minutes: true },
      }),
    ]);

    const healthScore =
      totalTodos > 0 ? Math.round(((totalTodos - overdueTodos) / totalTodos) * 100) : 100;

    const minutesToday = Number(hoursTodayAgg._sum.duration_minutes ?? 0);
    const hoursToday = Math.round((minutesToday / 60) * 10) / 10;

    return NextResponse.json({
      site: "ops.taskbullet.com",
      generated_at: now.toISOString(),
      health_score: healthScore,
      active_vas: activeVas,
      total_clients: totalClients,
      open_todos: openTodos,
      overdue_todos: overdueTodos,
      open_interventions: openInterventions,
      hours_today: hoursToday,
    });
  } catch (e) {
    console.error("[/api/admin/stats] failed:", e);
    return NextResponse.json(
      { error: "stats query failed", detail: String(e) },
      { status: 500 }
    );
  }
}
