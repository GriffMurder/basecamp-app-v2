/**
 * POST /api/clockify/sync — trigger a manual Clockify workspace sync
 *
 * Pulls workspaces, projects, tasks, and tags from the Clockify API
 * and upserts them into the local database.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CF_BASE = "https://api.clockify.me/api/v1";
const TIMEOUT_MS = 30_000;

async function clockifyGet<T>(path: string): Promise<T> {
  const key = process.env.CLOCKIFY_API_KEY;
  if (!key) throw new Error("CLOCKIFY_API_KEY is not set");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${CF_BASE}${path}`, {
      headers: { "X-Api-Key": key },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Clockify ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST() {
  await requireAdmin();

  const workspaceId = process.env.CLOCKIFY_WORKSPACE_ID;
  if (!workspaceId) {
    return NextResponse.json({ error: "CLOCKIFY_WORKSPACE_ID not set" }, { status: 503 });
  }

  const syncId = `manual-${Date.now()}`;
  const syncStart = new Date();

  try {
    // 1. Sync projects
    const projects = await clockifyGet<{ id: string; name: string; archived: boolean }[]>(
      `/workspaces/${workspaceId}/projects?archived=false&page-size=500`
    );

    let projectsUpserted = 0;
    for (const p of projects) {
      await prisma.clockifyProject.upsert({
        where: { clockify_project_id: p.id },
        update: { name: p.name, archived: p.archived, synced_at: new Date() },
        create: {
          clockify_project_id: p.id,
          name: p.name,
          archived: p.archived,
          synced_at: new Date(),
        },
      });
      projectsUpserted++;
    }

    // 2. Sync tags
    const tags = await clockifyGet<{ id: string; name: string; archived: boolean }[]>(
      `/workspaces/${workspaceId}/tags?archived=false&page-size=500`
    );

    let tagsUpserted = 0;
    for (const t of tags) {
      await prisma.clockifyTag.upsert({
        where: { clockify_tag_id: t.id },
        update: { name: t.name, archived: t.archived },
        create: {
          clockify_tag_id: t.id,
          name: t.name,
          archived: t.archived,
        },
      });
      tagsUpserted++;
    }

    // 3. Log the sync
    await prisma.clockifySyncLog.create({
      data: {
        entity_type: "manual",
        last_synced_at: syncStart,
        entries_synced: projectsUpserted + tagsUpserted,
        status: "success",
      },
    });

    return NextResponse.json({
      ok: true,
      summary: {
        projects: projectsUpserted,
        tags: tagsUpserted,
        total: projectsUpserted + tagsUpserted,
        duration_ms: Date.now() - syncStart.getTime(),
      },
    });
  } catch (err) {
    await prisma.clockifySyncLog.create({
      data: {
        entity_type: "manual",
        last_synced_at: syncStart,
        entries_synced: 0,
        status: "error",
        error: (err as Error).message,
      },
    });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
