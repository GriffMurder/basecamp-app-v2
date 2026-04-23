/**
 * POST /api/customers/[id]/rebuild-playbook
 *
 * Fires the Inngest "client-playbook-rebuild" event on demand so the ops team
 * can force a fresh playbook outside the nightly cron window.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin();
  const { id: rawId } = await params;
  const customerId = parseInt(rawId, 10);
  if (isNaN(customerId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true },
  });
  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  await inngest.send({
    name: "tb/playbook-rebuild.requested",
    data: { triggered_by: "manual", customer_id: customer.id },
  });

  return NextResponse.json({
    ok: true,
    message: `Playbook rebuild queued for ${customer.name}. Results will appear within 1–2 minutes.`,
  });
}
