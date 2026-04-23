/**
 * PATCH /api/admin/threads/[id]
 *
 * Marks a BasecampThreadActivity row as resolved.
 * Body: { action: "resolve" | "unresolve" }
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  const { id: rawId } = await params;
  const threadId = parseInt(rawId, 10);
  if (isNaN(threadId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body?.action ?? "resolve";

  const thread = await prisma.basecampThreadActivity.findUnique({
    where: { id: threadId },
    select: { id: true },
  });
  if (!thread) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (action === "unresolve") {
    await prisma.basecampThreadActivity.update({
      where: { id: threadId },
      data: { resolved_at: null, resolved_by: null },
    });
    return NextResponse.json({ ok: true, resolved: false });
  }

  // default: resolve
  const resolvedBy = session.user?.email ?? session.user?.name ?? "admin";
  await prisma.basecampThreadActivity.update({
    where: { id: threadId },
    data: { resolved_at: new Date(), resolved_by: resolvedBy },
  });

  return NextResponse.json({ ok: true, resolved: true, resolved_by: resolvedBy });
}
