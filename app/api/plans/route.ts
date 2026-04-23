/**
 * GET /api/plans — list task success plans (paginated, filterable)
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await requireAuth();
  const url = new URL(req.url);
  const status = url.searchParams.get("status"); // generated | confirmed | all
  const taskType = url.searchParams.get("task_type");
  const q = url.searchParams.get("q") ?? "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("page_size") ?? "50")));

  const where: Record<string, unknown> = {};
  if (status && status !== "all") where.status = status;
  if (taskType) where.task_type_final = taskType;
  if (q) where.basecamp_thread_id = { contains: q };

  const [plans, total] = await Promise.all([
    prisma.taskSuccessPlan.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: pageSize,
      skip: (page - 1) * pageSize,
      select: {
        id: true,
        basecamp_thread_id: true,
        task_type_suggested: true,
        task_type_final: true,
        status: true,
        confirmed_at: true,
        created_at: true,
        updated_at: true,
        generated_plan: true,
        va_modified_plan: true,
      },
    }),
    prisma.taskSuccessPlan.count({ where }),
  ]);

  return NextResponse.json({ ok: true, plans, total, page, page_size: pageSize });
}
