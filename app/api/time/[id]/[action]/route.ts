/**
 * POST /api/time/[id]/submit  — VA submits draft for approval
 * POST /api/time/[id]/approve — Manager approves → deduct from bucket
 * POST /api/time/[id]/reject  — Manager rejects with reason
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ApproveSchema = z.object({ manager_id: z.number().int().positive().optional() });
const RejectSchema = z.object({
  reason: z.string().min(1).max(500),
  manager_id: z.number().int().positive().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  await requireAuth();
  const { id, action } = await params;
  const entryId = parseInt(id);
  if (isNaN(entryId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const entry = await prisma.timeEntry.findUnique({ where: { id: entryId } });
  if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

  const now = new Date();

  if (action === "submit") {
    if (entry.status !== "draft")
      return NextResponse.json({ error: `Cannot submit — current status is '${entry.status}'` }, { status: 400 });
    if (entry.end_time === null && entry.start_time !== null)
      return NextResponse.json({ error: "Stop the timer before submitting" }, { status: 400 });
    if (Number(entry.duration_minutes) <= 0)
      return NextResponse.json({ error: "Duration must be > 0" }, { status: 400 });

    await prisma.timeEntry.update({
      where: { id: entryId },
      data: { status: "submitted" },
    });
    return NextResponse.json({ ok: true, entry_id: entryId, status: "submitted" });
  }

  if (action === "approve") {
    if (entry.status !== "submitted")
      return NextResponse.json({ error: `Cannot approve — current status is '${entry.status}'` }, { status: 400 });
    if (!entry.bucket_id)
      return NextResponse.json({ error: "Entry has no associated bucket" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const parsed = ApproveSchema.safeParse(body);
    const managerId = parsed.success ? (parsed.data.manager_id ?? null) : null;

    // Deduct from bucket with a transaction
    const bucketRow = await prisma.bucket.findUnique({
      where: { id: entry.bucket_id },
      select: { hours_balance: true, customer_id: true },
    });
    if (!bucketRow) return NextResponse.json({ error: "Bucket not found" }, { status: 400 });

    const hoursToDeduct = Number(entry.duration_minutes) / 60;
    const balance = Number(bucketRow.hours_balance);

    if (balance < hoursToDeduct) {
      return NextResponse.json(
        { error: `Insufficient bucket balance (${balance.toFixed(2)}h available, ${hoursToDeduct.toFixed(2)}h needed)` },
        { status: 400 }
      );
    }

    await prisma.$transaction([
      prisma.timeEntry.update({
        where: { id: entryId },
        data: { status: "approved", approved_at: now, approved_by: managerId },
      }),
      prisma.bucket.update({
        where: { id: entry.bucket_id },
        data: {
          hours_used: { increment: hoursToDeduct },
          hours_balance: { decrement: hoursToDeduct },
          status: balance - hoursToDeduct <= 0 ? "depleted" : undefined,
        },
      }),
      // Refresh customer denormalized balance
      prisma.$executeRaw`
        UPDATE customers SET bucket_balance = (
          SELECT COALESCE(SUM(hours_balance), 0)
          FROM buckets
          WHERE customer_id = ${entry.customer_id} AND status = 'active'
        ) WHERE id = ${entry.customer_id}
      `,
    ]);

    return NextResponse.json({ ok: true, entry_id: entryId, hours_deducted: hoursToDeduct, status: "approved" });
  }

  if (action === "reject") {
    if (entry.status !== "submitted")
      return NextResponse.json({ error: `Cannot reject — current status is '${entry.status}'` }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const parsed = RejectSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json({ error: "reason is required" }, { status: 400 });

    await prisma.timeEntry.update({
      where: { id: entryId },
      data: { status: "rejected", rejected_reason: parsed.data.reason },
    });
    return NextResponse.json({ ok: true, entry_id: entryId, status: "rejected" });
  }

  return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 });
}
