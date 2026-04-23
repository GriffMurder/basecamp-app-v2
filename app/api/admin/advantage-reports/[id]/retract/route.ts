/**
 * app/api/admin/advantage-reports/[id]/retract/route.ts
 * POST /api/admin/advantage-reports/:id/retract
 *
 * Resets a rendered (but not yet sent) report back to "draft" status.
 * Allows admins to pull back a report before the sender picks it up.
 *
 * Transitions: rendered → draft
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin();
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const report = await prisma.advantageReport.findUnique({ where: { id } });
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (report.status === "sent") {
    return NextResponse.json({ error: "Report already sent — cannot retract" }, { status: 409 });
  }
  if (report.status === "draft") {
    return NextResponse.json({ ok: true, id, status: "draft", noop: true });
  }

  const updated = await prisma.advantageReport.update({
    where: { id },
    data: { status: "draft" },
    select: { id: true, status: true },
  });

  return NextResponse.json({ ok: true, ...updated });
}