import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const report = await prisma.taskCompletionReport.findUnique({
      where: { id },
      select: { status: true, draft_report: true },
    });

    if (!report) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (report.status === "posted") {
      return NextResponse.json({ error: "Already posted" }, { status: 409 });
    }

    const updated = await prisma.taskCompletionReport.update({
      where: { id },
      data: {
        status: "approved",
        approved_at: new Date(),
        approved_report: report.draft_report as object,
      },
      select: { id: true, status: true },
    });

    return NextResponse.json({ ok: true, ...updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
