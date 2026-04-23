import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  assignee_id: z.string().optional(),
  assignee_name: z.string().optional(),
  due_on: z.string().nullable().optional(),
  completed: z.boolean().optional(),
  workflow_state: z.string().optional(),
});

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id: rawId } = await params;
  const id = parseInt(rawId);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const todo = await prisma.basecampTodo.findUnique({ where: { id } });
  if (!todo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, todo });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id: rawId } = await params;
  const id = parseInt(rawId);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json() as unknown;
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { due_on, ...rest } = parsed.data;
  const todo = await prisma.basecampTodo.update({
    where: { id },
    data: {
      ...rest,
      ...(due_on !== undefined ? { due_on: due_on ? new Date(due_on) : null } : {}),
      ...(parsed.data.completed === true ? { completed_at: new Date() } : {}),
    },
  });
  return NextResponse.json({ ok: true, todo });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id: rawId } = await params;
  const id = parseInt(rawId);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  await prisma.basecampTodo.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}