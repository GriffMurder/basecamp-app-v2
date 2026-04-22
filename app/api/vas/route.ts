/**
 * GET /api/vas — list active VAs with current load / scores
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  await requireAuth();
  const vas = await prisma.va.findMany({
    where: { active: true },
    orderBy: { display_name: "asc" },
    select: {
      id: true,
      display_name: true,
      email: true,
      slack_user_id: true,
      basecamp_person_id: true,
      reliability_score: true,
      capacity_index: true,
      last_scored_at: true,
      created_at: true,
    },
  });
  return NextResponse.json({ ok: true, vas });
}