/**
 * GET    /api/buckets/[id]        — Bucket detail with recent time entries
 * PATCH  /api/buckets/[id]        — Update bucket status / notes (admin)
 * DELETE /api/buckets/[id]        — Soft-delete bucket (admin)
 */
import { NextResponse } from "next/server";
import { requireAuth, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAuth();
  const { id } = await params;
  const bucketId = parseInt(id);
  if (isNaN(bucketId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const bucket = await prisma.bucket.findUnique({ where: { id: bucketId } });
  if (!bucket) return NextResponse.json({ error: "Bucket not found" }, { status: 404 });

  const entries = await prisma.timeEntry.findMany({
    where: { bucket_id: bucketId },
    orderBy: { created_at: "desc" },
    take: 100,
    select: {
      id: true,
      va_id: true,
      duration_minutes: true,
      description: true,
      status: true,
      start_time: true,
      end_time: true,
      approved_at: true,
      created_at: true,
    },
  });

  return NextResponse.json({
    ok: true,
    bucket: {
      ...bucket,
      hours_purchased: Number(bucket.hours_purchased),
      hours_used: Number(bucket.hours_used),
      hours_balance: Number(bucket.hours_balance),
      purchased_at: bucket.purchased_at?.toISOString(),
      rollover_date: bucket.rollover_date?.toISOString() ?? null,
      bonus_expires_at: bucket.bonus_expires_at?.toISOString() ?? null,
    },
    entries: entries.map((e) => ({
      ...e,
      duration_minutes: Number(e.duration_minutes),
      start_time: e.start_time?.toISOString() ?? null,
      end_time: e.end_time?.toISOString() ?? null,
      approved_at: e.approved_at?.toISOString() ?? null,
      created_at: e.created_at?.toISOString(),
    })),
  });
}

const PatchSchema = z.object({
  status: z.enum(["active", "depleted", "expired", "cancelled"]).optional(),
  notes: z.string().max(500).nullable().optional(),
  rollover_date: z.string().datetime().nullable().optional(),
  hpp_protected: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin();
  const { id } = await params;
  const bucketId = parseInt(id);
  if (isNaN(bucketId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) data.status = parsed.data.status;
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;
  if (parsed.data.rollover_date !== undefined)
    data.rollover_date = parsed.data.rollover_date ? new Date(parsed.data.rollover_date) : null;
  if (parsed.data.hpp_protected !== undefined) data.hpp_protected = parsed.data.hpp_protected;

  const bucket = await prisma.bucket.update({
    where: { id: bucketId },
    data,
  });

  return NextResponse.json({ ok: true, bucket });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin();
  const { id } = await params;
  const bucketId = parseInt(id);
  if (isNaN(bucketId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  await prisma.bucket.update({
    where: { id: bucketId },
    data: { status: "cancelled" },
  });

  return NextResponse.json({ ok: true });
}
