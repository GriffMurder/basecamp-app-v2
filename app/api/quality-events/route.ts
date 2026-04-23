/**
 * GET /api/quality-events — list TaskQualityEvent records
 * Query params:
 *   event_type: REVISION_REQUESTED | NEGATIVE_FEEDBACK | CLIENT_NO_RESPONSE_AFTER_DELIVERY
 *   thread_id: filter by basecamp_thread_id
 *   page, page_size
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await requireAuth();
  const url = new URL(req.url);
  const eventType = url.searchParams.get("event_type");
  const threadId = url.searchParams.get("thread_id");
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get("page_size") ?? "50")));

  const where: Record<string, unknown> = {};
  if (eventType) where.event_type = eventType;
  if (threadId) where.basecamp_thread_id = threadId;

  const [events, total] = await Promise.all([
    prisma.taskQualityEvent.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: pageSize,
      skip: (page - 1) * pageSize,
      select: {
        id: true,
        basecamp_thread_id: true,
        basecamp_comment_id: true,
        comment_author: true,
        event_type: true,
        matched_keywords: true,
        snippet: true,
        created_at: true,
      },
    }),
    prisma.taskQualityEvent.count({ where }),
  ]);

  return NextResponse.json({ ok: true, events, total, page, page_size: pageSize });
}
