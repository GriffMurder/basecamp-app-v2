/**
 * GET    /api/time-tracking/[id] — get a single time entry
 * PATCH  /api/time-tracking/[id] — update a time entry
 * DELETE /api/time-tracking/[id] — delete (only if draft/not payroll_locked)
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
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
  const entry = await prisma.timeEntry.findUnique({ where: { id: parseInt(id) } });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, entry });
}

const PatchSchema = z.object({
  duration_minutes: z.number().positive().optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(["draft", "pending", "approved", "rejected"]).optional(),
  start_time: z.string().datetime().nullable().optional(),
  end_time: z.string().datetime().nullable().optional(),
  rejected_reason: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  const { id } = await params;
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.timeEntry.findUnique({ where: { id: parseInt(id) } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.payroll_locked) {
    return NextResponse.json({ error: "Entry is payroll-locked" }, { status: 409 });
  }

  // Append to edit_history
  const editHistory = Array.isArray(existing.edit_history) ? existing.edit_history : [];
  const historyEntry = {
    edited_at: new Date().toISOString(),
    edited_by: (session.user as { id?: string }).id ?? "unknown",
    previous: {
      duration_minutes: String(existing.duration_minutes),
      description: existing.description,
      status: existing.status,
    },
    changes: parsed.data,
  };

  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status === "approved") {
    updateData.approved_at = new Date();
    updateData.approved_by = parseInt((session.user as { id?: string }).id ?? "0") || null;
  }

  const entry = await prisma.timeEntry.update({
    where: { id: parseInt(id) },
    data: {
      ...updateData,
      edit_history: [...editHistory, historyEntry],
    },
  });

  return NextResponse.json({ ok: true, entry });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAuth();
  const { id } = await params;
  const existing = await prisma.timeEntry.findUnique({ where: { id: parseInt(id) } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.payroll_locked) {
    return NextResponse.json({ error: "Entry is payroll-locked and cannot be deleted" }, { status: 409 });
  }
  if (!["draft", "rejected"].includes(existing.status)) {
    return NextResponse.json({ error: "Only draft or rejected entries can be deleted" }, { status: 409 });
  }
  await prisma.timeEntry.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ ok: true });
}
