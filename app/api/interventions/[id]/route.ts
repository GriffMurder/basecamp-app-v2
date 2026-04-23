/**
 * PATCH /api/interventions/[id] — update status or resolution
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  status: z.enum(["open", "resolved", "escalated"]).optional(),
  resolution_kind: z.string().max(100).optional(),
  resolution_note: z.string().max(2000).optional(),
  root_cause_category: z.string().max(100).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAuth();
  const { id } = await params;
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status === "resolved") {
    updateData.resolved_at = new Date();
  }

  const updated = await prisma.intervention.update({
    where: { id: BigInt(id) },
    data: updateData,
    select: {
      id: true,
      status: true,
      resolution_kind: true,
      resolution_note: true,
      resolved_at: true,
    },
  });

  return NextResponse.json({ ok: true, intervention: { ...updated, id: String(updated.id) } });
}
