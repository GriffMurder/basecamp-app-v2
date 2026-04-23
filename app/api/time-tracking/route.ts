/**
 * GET  /api/time-tracking — list time entries (paginated, filterable)
 * POST /api/time-tracking — create a new time entry
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await requireAuth();
  const url = new URL(req.url);
  const customerId = url.searchParams.get("customer_id");
  const vaId = url.searchParams.get("va_id");
  const status = url.searchParams.get("status");
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("page_size") ?? "50")));

  const where: Record<string, unknown> = {};
  if (customerId) where.customer_id = parseInt(customerId);
  if (vaId) where.va_id = parseInt(vaId);
  if (status) where.status = status;

  const [entries, total] = await Promise.all([
    prisma.timeEntry.findMany({
      where,
      take: pageSize,
      skip: (page - 1) * pageSize,
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        customer_id: true,
        va_id: true,
        bucket_id: true,
        basecamp_todo_id: true,
        start_time: true,
        end_time: true,
        duration_minutes: true,
        description: true,
        status: true,
        approved_at: true,
        approved_by: true,
        rejected_reason: true,
        payroll_locked: true,
        created_at: true,
        updated_at: true,
      },
    }),
    prisma.timeEntry.count({ where }),
  ]);

  return NextResponse.json({ ok: true, entries, total, page, page_size: pageSize });
}

const CreateSchema = z.object({
  customer_id: z.number().int().positive(),
  va_id: z.number().int().positive().optional(),
  bucket_id: z.number().int().positive().optional(),
  basecamp_todo_id: z.string().optional(),
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
  duration_minutes: z.number().positive(),
  description: z.string().max(2000).optional(),
  status: z.enum(["draft", "pending", "approved", "rejected"]).default("draft"),
  notes: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  const session = await requireAuth();
  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const { duration_minutes, ...rest } = parsed.data;

  const entry = await prisma.timeEntry.create({
    data: {
      ...rest,
      duration_minutes,
      dashboard_user_id: parseInt((session.user as { id?: string }).id ?? "0") || null,
      ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      user_agent: req.headers.get("user-agent") ?? null,
    },
  });

  return NextResponse.json({ ok: true, entry }, { status: 201 });
}
