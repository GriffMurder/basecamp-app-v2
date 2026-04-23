/**
 * GET  /api/buckets?customer_id=  — List buckets for a customer
 * POST /api/buckets                — Create a bucket (admin)
 * POST /api/buckets/manual-add    — Admin: add hours to a customer's active bucket
 */
import { NextResponse } from "next/server";
import { requireAuth, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await requireAuth();
  const url = new URL(req.url);
  const customerId = url.searchParams.get("customer_id");
  const status = url.searchParams.get("status");

  const where: Record<string, unknown> = {};
  if (customerId) where.customer_id = parseInt(customerId);
  if (status) where.status = status;

  const buckets = await prisma.bucket.findMany({
    where,
    orderBy: [{ status: "asc" }, { rollover_date: "asc" }],
  });

  const result = buckets.map((b) => ({
    ...b,
    hours_purchased: Number(b.hours_purchased),
    hours_used: Number(b.hours_used),
    hours_balance: Number(b.hours_balance),
    purchased_at: b.purchased_at?.toISOString(),
    rollover_date: b.rollover_date?.toISOString() ?? null,
    bonus_expires_at: b.bonus_expires_at?.toISOString() ?? null,
    hpp_paused_at: b.hpp_paused_at?.toISOString() ?? null,
    hpp_resumed_at: b.hpp_resumed_at?.toISOString() ?? null,
    created_at: b.created_at?.toISOString(),
    updated_at: b.updated_at?.toISOString(),
  }));

  return NextResponse.json({ ok: true, buckets: result, count: result.length });
}

const ManualAddSchema = z.object({
  customer_id: z.number().int().positive(),
  hours: z.number().positive().max(500),
  notes: z.string().max(500).optional(),
  is_bonus: z.boolean().default(false),
  bonus_expires_at: z.string().datetime().optional(),
});

export async function POST(req: Request) {
  await requireAdmin();
  const url = new URL(req.url);

  // Check if this is a manual-add call (path segment handled here as a body action)
  const body = await req.json();

  if (url.pathname.endsWith("/manual-add")) {
    const parsed = ManualAddSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }
    const { customer_id, hours, notes, is_bonus, bonus_expires_at } = parsed.data;

    const bucket = await prisma.bucket.create({
      data: {
        customer_id,
        hours_purchased: hours,
        hours_used: 0,
        hours_balance: hours,
        status: "active",
        notes: notes ?? null,
        is_bonus,
        bonus_expires_at: bonus_expires_at ? new Date(bonus_expires_at) : null,
        purchased_at: new Date(),
      },
    });

    // Refresh customer denormalized balance
    await prisma.$executeRaw`
      UPDATE customers SET bucket_balance = (
        SELECT COALESCE(SUM(hours_balance), 0)
        FROM buckets
        WHERE customer_id = ${customer_id} AND status = 'active'
      ) WHERE id = ${customer_id}
    `;

    return NextResponse.json(
      { ok: true, bucket_id: bucket.id, hours_added: hours },
      { status: 201 }
    );
  }

  // Create a generic bucket
  const CreateSchema = z.object({
    customer_id: z.number().int().positive(),
    hours_purchased: z.number().positive().max(1000),
    notes: z.string().max(500).optional(),
    rollover_date: z.string().datetime().optional(),
    stripe_payment_id: z.string().max(200).optional(),
  });
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { customer_id, hours_purchased, notes, rollover_date, stripe_payment_id } = parsed.data;

  const bucket = await prisma.bucket.create({
    data: {
      customer_id,
      hours_purchased,
      hours_used: 0,
      hours_balance: hours_purchased,
      status: "active",
      notes: notes ?? null,
      rollover_date: rollover_date ? new Date(rollover_date) : null,
      stripe_payment_id: stripe_payment_id ?? null,
    },
  });

  return NextResponse.json({ ok: true, bucket }, { status: 201 });
}
