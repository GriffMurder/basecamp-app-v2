/**
 * GET  /api/interventions — list interventions (paginated, filterable)
 * PATCH /api/interventions/[id] — update status/resolution
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await requireAuth();
  const url = new URL(req.url);
  const level = url.searchParams.get("level");       // va | manager | founder
  const status = url.searchParams.get("status");     // open | resolved | all
  const customerId = url.searchParams.get("customer_id");
  const todoId = url.searchParams.get("todo_id");
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get("page_size") ?? "50")));

  const where: Record<string, unknown> = {};
  if (level) where.level = level;
  if (status && status !== "all") where.status = status;
  if (customerId) where.customer_id = parseInt(customerId);
  if (todoId) where.todo_id = todoId;

  const [interventions, total] = await Promise.all([
    prisma.intervention.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: pageSize,
      skip: (page - 1) * pageSize,
      select: {
        id: true,
        level: true,
        reason: true,
        target_person_id: true,
        customer_id: true,
        todo_id: true,
        status: true,
        created_at: true,
        sent_at: true,
        response_at: true,
        resolved_at: true,
        resolution_kind: true,
        root_cause_category: true,
        resolution_note: true,
        sla_due_at: true,
        sla_breached_at: true,
        parent_intervention_id: true,
      },
    }),
    prisma.intervention.count({ where }),
  ]);

  return NextResponse.json({
    ok: true,
    interventions: interventions.map((i) => ({ ...i, id: String(i.id), parent_intervention_id: i.parent_intervention_id ? String(i.parent_intervention_id) : null })),
    total,
    page,
    page_size: pageSize,
  });
}
