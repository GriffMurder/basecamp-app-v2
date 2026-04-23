/**
 * GET /api/payments — list recent payment events (PayPal + Veem + Stripe)
 * Admin-only.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await requireAdmin();
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
  const provider = url.searchParams.get("provider"); // paypal | veem | stripe

  const where: Record<string, unknown> = {};
  if (provider) where.provider = provider;

  const events = await prisma.paymentEvent.findMany({
    where,
    orderBy: { created_at: "desc" },
    take: limit,
    select: {
      id: true,
      provider: true,
      event_type: true,
      provider_ref: true,
      amount_cents: true,
      currency: true,
      customer_id: true,
      status: true,
      bucket_id: true,
      error: true,
      created_at: true,
    },
  });

  const result = events.map((e) => ({
    ...e,
    amount_usd: e.amount_cents ? (e.amount_cents / 100).toFixed(2) : null,
    created_at: e.created_at?.toISOString(),
  }));

  return NextResponse.json({ ok: true, payments: result, count: result.length });
}
