/**
 * GET /api/audit — system activity log
 * Returns recent interactions, interventions, and AI tasks for audit viewing.
 * Accessible to owner / super_admin / admin roles only.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await requireAdmin();
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "all"; // interactions | interventions | ai_tasks | all
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("page_size") ?? "50")));
  const skip = (page - 1) * pageSize;

  const [interactions, interventions, aiTasks] = await Promise.all([
    (type === "all" || type === "interactions")
      ? prisma.interaction.findMany({
          take: pageSize,
          skip,
          orderBy: { happened_at: "desc" },
          select: {
            id: true,
            source: true,
            customer_id: true,
            todo_id: true,
            interaction_type: true,
            happened_at: true,
          },
        })
      : [],
    (type === "all" || type === "interventions")
      ? prisma.intervention.findMany({
          take: pageSize,
          skip,
          orderBy: { created_at: "desc" },
          select: {
            id: true,
            level: true,
            reason: true,
            target_person_id: true,
            customer_id: true,
            status: true,
            created_at: true,
            sent_at: true,
            resolved_at: true,
            resolution_kind: true,
          },
        })
      : [],
    (type === "all" || type === "ai_tasks")
      ? prisma.aiTask.findMany({
          take: pageSize,
          skip,
          orderBy: { created_at: "desc" },
          select: {
            id: true,
            basecamp_todo_id: true,
            basecamp_project_id: true,
            title: true,
            status: true,
            created_at: true,
            updated_at: true,
          },
        })
      : [],
  ]);

  return NextResponse.json({
    ok: true,
    interactions,
    interventions,
    ai_tasks: aiTasks,
    page,
    page_size: pageSize,
  });
}
