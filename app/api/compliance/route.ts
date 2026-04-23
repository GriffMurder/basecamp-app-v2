/**
 * GET  /api/compliance/export — download all personal data for the current user
 * POST /api/compliance/delete — anonymize current user's personal data (GDPR right to erasure)
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await requireAuth();
  const email = (session.user as { email?: string }).email ?? "";

  const user = await prisma.dashboardUser.findUnique({ where: { email } });
  if (!user) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const [timeEntries, interactions] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { dashboard_user_id: user.id },
      orderBy: { created_at: "desc" },
      select: {
        id: true, customer_id: true, va_id: true, duration_minutes: true,
        description: true, status: true, start_time: true, end_time: true,
        created_at: true,
      },
    }),
    prisma.interaction.findMany({
      where: { person_id: user.id },
      orderBy: { happened_at: "desc" },
      take: 500,
      select: {
        id: true, source: true, interaction_type: true, happened_at: true,
        customer_id: true,
      },
    }),
  ]);

  const exportData = {
    exported_at: new Date().toISOString(),
    profile: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      name: user.name,
      role: user.role,
      created_at: user.created_at?.toISOString(),
      last_login_at: user.last_login_at?.toISOString() ?? null,
    },
    time_entries: timeEntries.map((e) => ({
      ...e,
      duration_minutes: String(e.duration_minutes),
      start_time: e.start_time?.toISOString() ?? null,
      end_time: e.end_time?.toISOString() ?? null,
      created_at: e.created_at?.toISOString(),
    })),
    interactions: interactions.map((i) => ({
      ...i,
      happened_at: i.happened_at?.toISOString(),
    })),
  };

  const json = JSON.stringify(exportData, null, 2);
  const filename = `my-data-export-${new Date().toISOString().split("T")[0]}.json`;

  return new Response(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export async function POST(req: Request) {
  const session = await requireAuth();
  const email = (session.user as { email?: string }).email ?? "";

  const body = await req.json().catch(() => ({}));
  if (body.confirm !== "DELETE_MY_DATA") {
    return NextResponse.json(
      { error: 'Body must include {"confirm": "DELETE_MY_DATA"}' },
      { status: 400 }
    );
  }

  const user = await prisma.dashboardUser.findUnique({ where: { email } });
  if (!user) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  // Anonymize personal data (GDPR right to erasure)
  await prisma.dashboardUser.update({
    where: { id: user.id },
    data: {
      email: `deleted-${user.id}@anonymized.invalid`,
      display_name: "Deleted User",
      name: null,
      password_hash: null,
      auth_user_id: null,
      away_note: null,
      active: false,
    },
  });

  // Clear PII from time entries
  await prisma.timeEntry.updateMany({
    where: { dashboard_user_id: user.id },
    data: { ip_address: null, user_agent: null, geo_location: Prisma.DbNull, notes: null },
  });

  return NextResponse.json({
    ok: true,
    message: "Personal data has been anonymized. Your account is now deactivated.",
  });
}
