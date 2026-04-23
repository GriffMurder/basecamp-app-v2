/**
 * app/api/admin/intake/[id]/reset/route.ts
 *
 * POST /api/admin/intake/:id/reset
 * Clears the intake gate state for a given BasecampTodo so it will be
 * re-evaluated on the next intake-gate-scan cycle.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin();
  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const todo = await prisma.basecampTodo.findUnique({ where: { id } });
  if (!todo) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.basecampTodo.update({
    where: { id },
    data: {
      intake_state: null,
      intake_ping_count: 0,
      intake_last_ping_at: null,
      intake_comment_id: null,
    },
  });

  return NextResponse.json({ ok: true, id });
}