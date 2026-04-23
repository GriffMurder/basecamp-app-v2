/**
 * POST /api/vas/[id]/rebuild-snapshot
 *
 * Fires the Inngest "va-snapshot-daily" event on demand so the ops team
 * can force a fresh snapshot outside the nightly cron window.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";
import { notFound } from "next/navigation";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin();
  const { id: rawId } = await params;
  const vaId = parseInt(rawId, 10);
  if (isNaN(vaId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const va = await prisma.va.findUnique({
    where: { id: vaId },
    select: { id: true, display_name: true },
  });
  if (!va) {
    return NextResponse.json({ error: "VA not found" }, { status: 404 });
  }

  await inngest.send({
    name: "tb/va-snapshot-daily.requested",
    data: { triggered_by: "manual", va_id: va.id },
  });

  return NextResponse.json({
    ok: true,
    message: `Snapshot rebuild queued for ${va.display_name}. Results will appear within 1–2 minutes.`,
  });
}
