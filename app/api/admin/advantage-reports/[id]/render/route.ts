/**
 * app/api/admin/advantage-reports/[id]/render/route.ts
 * POST /api/admin/advantage-reports/:id/render
 *
 * Marks an AdvantageReport as "rendered" so the advantage-report-sender
 * Inngest function will pick it up on its next run.
 *
 * Transitions: draft → rendered
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
    return NextResponse.json({ error: "Report already sent — cannot re-render" }, { status: 409 });
  }

  const updated = await prisma.advantageReport.update({
    where: { id },
    data: { status: "rendered" },
    select: { id: true, status: true },
  });

  return NextResponse.json({ ok: true, ...updated });
}