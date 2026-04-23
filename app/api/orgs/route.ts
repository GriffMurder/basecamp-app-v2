/**
 * GET  /api/orgs — list organizations
 * POST /api/orgs — create a new organization
 * Requires owner or super_admin role.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await requireAdmin();
  const orgs = await prisma.organization.findMany({
    orderBy: { name: "asc" },
    select: { id: true, slug: true, name: true, is_active: true, created_at: true },
  });
  return NextResponse.json({ ok: true, orgs });
}

const CreateSchema = z.object({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with hyphens"),
  name: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  await requireAdmin();
  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.organization.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) {
    return NextResponse.json({ error: "An organization with this slug already exists" }, { status: 409 });
  }

  const org = await prisma.organization.create({ data: parsed.data });
  return NextResponse.json({ ok: true, org }, { status: 201 });
}
