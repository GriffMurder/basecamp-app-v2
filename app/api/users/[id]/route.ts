import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const patchSchema = z.object({
  role: z.enum(["va", "manager", "super_admin", "owner", "pending"]).optional(),
  active: z.boolean().optional(),
  display_name: z.string().min(1).max(100).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  await requireRole(["super_admin", "owner"]);
  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json() as unknown;
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const user = await prisma.dashboardUser.update({
    where: { id },
    data: parsed.data,
    select: { id: true, email: true, role: true, active: true, display_name: true },
  });
  return NextResponse.json({ ok: true, user });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  await requireRole(["owner"]);
  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  await prisma.dashboardUser.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}