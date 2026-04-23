/**
 * GET  /api/ops-briefs — list weekly ops briefs
 * POST /api/ops-briefs — trigger generation of a new brief (admin only)
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await requireAuth();
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(52, Math.max(1, parseInt(url.searchParams.get("page_size") ?? "12")));

  const [briefs, total] = await Promise.all([
    prisma.opsWeeklyBrief.findMany({
      orderBy: { week_start: "desc" },
      take: pageSize,
      skip: (page - 1) * pageSize,
      select: {
        id: true,
        week_start: true,
        generated_at: true,
        brief_json: true,
        brief_text: true,
        model: true,
        prompt_version: true,
      },
    }),
    prisma.opsWeeklyBrief.count(),
  ]);

  return NextResponse.json({ ok: true, briefs, total, page, page_size: pageSize });
}

export async function POST(req: Request) {
  await requireAdmin();
  const body = await req.json().catch(() => ({}));
  const weekStartRaw = body.week_start as string | undefined;

  // Determine week_start (Monday)
  const now = new Date();
  let weekStart: Date;
  if (weekStartRaw) {
    weekStart = new Date(weekStartRaw);
  } else {
    // Current Monday
    const day = now.getDay(); // 0=Sun
    const diff = day === 0 ? -6 : 1 - day;
    weekStart = new Date(now);
    weekStart.setDate(now.getDate() + diff);
    weekStart.setHours(0, 0, 0, 0);
  }

  // Gather ops data
  const [openInterventions, openTodos, vaCount, atRiskClients, qualityEvents] = await Promise.all([
    prisma.intervention.count({ where: { status: "open" } }),
    prisma.basecampTodo.count({ where: { completed: false } }),
    prisma.va.count({ where: { active: true } }),
    prisma.customer.count({ where: { active: true } }),
    prisma.taskQualityEvent.count({
      where: { created_at: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    }),
  ]);

  const sourceData = {
    week_start: weekStart.toISOString().split("T")[0],
    generated_at: new Date().toISOString(),
    demand_supply: {
      open_todos: openTodos,
      active_vas: vaCount,
      active_clients: atRiskClients,
    },
    quality: {
      quality_events_7d: qualityEvents,
    },
    sla: {
      open_escalations: openInterventions,
    },
  };

  // Simple deterministic brief (no AI call — AI trigger can be added later)
  const briefJson = {
    system_health: {
      summary: `open_todos=${openTodos}, open_escalations=${openInterventions}, active_vas=${vaCount}`,
      signals: [`quality_events_7d=${qualityEvents}`],
    },
    va_performance: { highlights: [], concerns: [] },
    client_risk: {
      signals: [`active_clients=${atRiskClients}`],
      notes: [],
    },
    demand_supply: {
      imbalances: [],
      notes: [`${openTodos} open tasks across ${vaCount} active VAs`],
    },
    recommendations: [],
    questions: [],
    text: `Week of ${weekStart.toISOString().split("T")[0]}: ${openTodos} open tasks, ${openInterventions} open escalations, ${qualityEvents} quality events in the last 7 days.`,
  };

  const brief = await prisma.opsWeeklyBrief.create({
    data: {
      week_start: weekStart,
      source_data_json: sourceData,
      brief_json: briefJson,
      brief_text: briefJson.text,
      model: "deterministic",
      prompt_version: "v1",
    },
    select: {
      id: true,
      week_start: true,
      generated_at: true,
      brief_json: true,
      brief_text: true,
      model: true,
    },
  });

  return NextResponse.json({ ok: true, brief }, { status: 201 });
}
