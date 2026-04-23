/**
 * POST /api/buckets/manual-add — Admin: provision hours to a customer's active bucket
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  customer_id: z.number().int().positive(),
  hours: z.number().positive().max(500),
  notes: z.string().max(500).optional(),
  is_bonus: z.boolean().default(false),
  bonus_expires_at: z.string().datetime().optional(),
});

export async function POST(req: Request) {
  await requireAdmin();
  const body = await req.json();
  const parsed = Schema.safeParse(body);
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
