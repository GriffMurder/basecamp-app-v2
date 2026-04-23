/**
 * PATCH  /api/orgs/[id] — update name or is_active
 * DELETE /api/orgs/[id] — deactivate (soft delete)
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin();
  const { id } = await params;
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const org = await prisma.organization.update({
    where: { id: parseInt(id) },
    data: parsed.data,
  });
  return NextResponse.json({ ok: true, org });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin();
  const { id } = await params;
  await prisma.organization.update({
    where: { id: parseInt(id) },
    data: { is_active: false },
  });
  return NextResponse.json({ ok: true });
}
