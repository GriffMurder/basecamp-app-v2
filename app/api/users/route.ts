import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

/** GET /api/users — list all dashboard users (super_admin+) */
export async function GET() {
  await requireRole(["super_admin", "owner"]);
  const users = await prisma.dashboardUser.findMany({
    orderBy: [{ role: "asc" }, { display_name: "asc" }],
    select: {
      id: true, email: true, display_name: true, role: true,
      active: true, org_id: true, manager_id: true, created_at: true,
    },
  });
  return NextResponse.json({ ok: true, users });
}

const approveSchema = z.object({
  userId: z.number().int(),
  role: z.enum(["va", "manager", "super_admin", "owner"]).default("va"),
});

/** POST /api/users — approve or update a user */
export async function POST(req: Request) {
  await requireRole(["super_admin", "owner"]);
  const body = await req.json() as unknown;
  const parsed = approveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const user = await prisma.dashboardUser.update({
    where: { id: parsed.data.userId },
    data: { role: parsed.data.role, active: true },
    select: { id: true, email: true, role: true, active: true },
  });
  return NextResponse.json({ ok: true, user });
}