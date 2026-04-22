import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await requireAuth();
  const email = (session.user as { email?: string }).email ?? "";
  const user = await prisma.dashboardUser.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      display_name: true,
      role: true,
      active: true,
      org_id: true,
      manager_id: true,
      created_at: true,
    },
  });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, user });
}