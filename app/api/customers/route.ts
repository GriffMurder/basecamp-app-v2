/**
 * GET  /api/customers — list active customers
 * POST /api/customers — create a customer
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET(req: Request) {
  await requireAuth();
  const url = new URL(req.url);
  const active = url.searchParams.get("active");
  const search = url.searchParams.get("q");

  const customers = await prisma.customer.findMany({
    where: {
      ...(active !== null ? { active: active !== "false" } : {}),
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
    },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, active: true, effective_tier: true,
      client_health_score: true, bucket_balance: true,
      basecamp_project_id: true, clockify_client_id: true,
      slack_channel_id: true, last_scored_at: true,
    },
    take: 200,
  });
  return NextResponse.json({ ok: true, customers });
}

const createSchema = z.object({
  name: z.string().min(1).max(255),
  basecamp_project_id: z.string().optional(),
  clockify_client_id: z.string().optional(),
  slack_channel_id: z.string().optional(),
  external_id: z.string().optional(),
});

export async function POST(req: Request) {
  await requireAuth();
  const body = await req.json() as unknown;
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const customer = await prisma.customer.create({ data: parsed.data });
  return NextResponse.json({ ok: true, customer }, { status: 201 });
}