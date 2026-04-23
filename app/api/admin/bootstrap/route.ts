import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  display_name: z.string().min(1).max(100).optional(),
  bootstrap_token: z.string().min(1),
});

export async function POST(req: Request) {
  const expected = process.env.BOOTSTRAP_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "Bootstrap disabled" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.bootstrap_token !== expected) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const existingOwner = await prisma.dashboardUser.findFirst({ where: { role: "owner" } });
  if (existingOwner) {
    return NextResponse.json({ error: "Owner already exists" }, { status: 409 });
  }

  const password_hash = await bcrypt.hash(parsed.data.password, 10);
  const user = await prisma.dashboardUser.create({
    data: {
      email: parsed.data.email.toLowerCase(),
      password_hash,
      role: "owner",
      active: true,
      display_name: parsed.data.display_name ?? "Owner",
    },
    select: { id: true, email: true, role: true, display_name: true },
  });

  return NextResponse.json({ ok: true, user });
}