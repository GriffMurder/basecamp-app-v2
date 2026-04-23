import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuth();
  const email = (session.user as { email?: string }).email ?? "";
  const user = await prisma.dashboardUser.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      display_name: true,
      name: true,
      role: true,
      active: true,
      availability_status: true,
      away_note: true,
      org_id: true,
      manager_id: true,
      last_login_at: true,
      created_at: true,
    },
  });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, user });
}

const PatchSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  away_note: z.string().max(500).nullable().optional(),
  availability_status: z.enum(["available", "away", "busy", "offline"]).optional(),
});

export async function PATCH(req: Request) {
  const session = await requireAuth();
  const email = (session.user as { email?: string }).email ?? "";
  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const updated = await prisma.dashboardUser.updateMany({
    where: { email },
    data: parsed.data,
  });
  if (updated.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}