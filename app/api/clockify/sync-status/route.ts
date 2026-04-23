/**
 * GET  /api/clockify/sync-status — check last sync log
 * POST /api/clockify/sync       — trigger a manual sync of Clockify data
 * Requires admin role.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await requireAdmin();

  const logs = await prisma.clockifySyncLog.findMany({
    orderBy: { created_at: "desc" },
    take: 10,
    select: {
      id: true,
      entity_type: true,
      status: true,
      entries_synced: true,
      error: true,
      last_synced_at: true,
      created_at: true,
    },
  });

  const [projects, tags, tasks] = await Promise.all([
    prisma.clockifyProject.count(),
    prisma.clockifyTag.count(),
    prisma.clockifyTask.count(),
  ]);

  return NextResponse.json({
    ok: true,
    entity_counts: { projects, tags, tasks },
    recent_syncs: logs,
  });
}
