import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  await requireAuth();
  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, customer });
}

const patchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  active: z.boolean().optional(),
  effective_tier: z.string().optional(),
  manual_tier: z.string().optional(),
  slack_channel_id: z.string().optional(),
  basecamp_project_id: z.string().optional(),
  clockify_client_id: z.string().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  await requireAuth();
  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json() as unknown;
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const customer = await prisma.customer.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ ok: true, customer });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  await requireRole(["super_admin", "owner"]);
  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  // Soft-delete only
  await prisma.customer.update({ where: { id }, data: { active: false } });
  return NextResponse.json({ ok: true });
}

import { requireRole } from "@/lib/auth";