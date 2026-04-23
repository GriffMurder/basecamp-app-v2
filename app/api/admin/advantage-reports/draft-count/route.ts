import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  await requireAdmin();
  const count = await prisma.advantageReport.count({ where: { status: "draft" } });
  return NextResponse.json({ count });
}