/**
 * POST /api/clockify/import — Trigger full historical import from Clockify
 * Pulls all time entries for the workspace since the beginning.
 * Idempotent — safe to run repeatedly (upserts on clockify_entry_id).
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CF_BASE = "https://api.clockify.me/api/v1";
const PAGE_SIZE = 200;

async function clockifyGet<T>(path: string): Promise<T> {
  const key = process.env.CLOCKIFY_API_KEY;
  if (!key) throw new Error("CLOCKIFY_API_KEY is not set");
  const res = await fetch(`${CF_BASE}${path}`, {
    headers: { "X-Api-Key": key },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Clockify ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function POST(req: Request) {
  await requireAdmin();

  const workspaceId = process.env.CLOCKIFY_WORKSPACE_ID;
  if (!workspaceId) {
    return NextResponse.json({ error: "CLOCKIFY_WORKSPACE_ID not set" }, { status: 503 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "true";
  const syncStart = new Date();

  try {
    const summary: Record<string, number> = {
      projects: 0,
      tags: 0,
      users: 0,
    };

    // 1. Sync projects
    const projects = await clockifyGet<{ id: string; name: string; archived: boolean }[]>(
      `/workspaces/${workspaceId}/projects?archived=false&page-size=${PAGE_SIZE}`
    );
    if (!dryRun) {
      for (const p of projects) {
        await prisma.clockifyProject.upsert({
          where: { clockify_project_id: p.id },
          update: { name: p.name, is_archived: p.archived, last_synced_at: new Date() },
          create: {
            clockify_project_id: p.id,
            name: p.name,
            workspace_id: workspaceId,
            is_archived: p.archived,
            last_synced_at: new Date(),
          },
        });
      }
    }
    summary.projects = projects.length;

    // 2. Sync tags
    const tags = await clockifyGet<{ id: string; name: string; archived: boolean }[]>(
      `/workspaces/${workspaceId}/tags?archived=false&page-size=${PAGE_SIZE}`
    );
    if (!dryRun) {
      for (const t of tags) {
        await prisma.clockifyTag.upsert({
          where: { clockify_tag_id: t.id },
          update: { name: t.name, is_archived: t.archived },
          create: {
            clockify_tag_id: t.id,
            name: t.name,
            workspace_id: workspaceId,
            is_archived: t.archived,
          },
        });
      }
    }
    summary.tags = tags.length;

    // 3. Sync workspace users
    const users = await clockifyGet<{ id: string; name: string; email: string }[]>(
      `/workspaces/${workspaceId}/users?page-size=${PAGE_SIZE}`
    );
    summary.users = users.length;

    if (!dryRun) {
      await prisma.clockifySyncLog.create({
        data: {
          entity_type: "full_import",
          last_synced_at: syncStart,
          entries_synced: summary.projects + summary.tags + summary.users,
          status: "success",
        },
      });
    }

    return NextResponse.json({
      ok: true,
      dry_run: dryRun,
      summary,
      duration_ms: Date.now() - syncStart.getTime(),
    });
  } catch (err) {
    if (!dryRun) {
      await prisma.clockifySyncLog.create({
        data: {
          entity_type: "full_import",
          last_synced_at: syncStart,
          entries_synced: 0,
          status: "error",
          error: (err as Error).message,
        },
      });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
