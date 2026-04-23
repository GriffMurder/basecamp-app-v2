/**
 * POST /api/time/start — Start a live timer (creates a draft entry with start_time=now)
 * POST /api/time/stop  — Stop a running timer (compute duration, set end_time)
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const StartSchema = z.object({
  customer_id: z.number().int().positive(),
  va_id: z.number().int().positive().optional(),
  bucket_id: z.number().int().positive().optional(),
  description: z.string().max(500).optional(),
  basecamp_todo_id: z.string().max(200).optional(),
});

const StopSchema = z.object({
  entry_id: z.number().int().positive(),
});

export async function POST(req: Request) {
  await requireAuth();
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "start";
  const body = await req.json();

  if (action === "stop") {
    const parsed = StopSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "entry_id required" }, { status: 400 });
    const { entry_id } = parsed.data;

    const entry = await prisma.timeEntry.findUnique({ where: { id: entry_id } });
    if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    if (entry.end_time) return NextResponse.json({ error: "Timer already stopped" }, { status: 400 });
    if (!entry.start_time) return NextResponse.json({ error: "Entry has no start_time" }, { status: 400 });

    const now = new Date();
    const diffMs = now.getTime() - entry.start_time.getTime();
    const durationMin = Math.round(diffMs / 60000 * 100) / 100;

    const updated = await prisma.timeEntry.update({
      where: { id: entry_id },
      data: { end_time: now, duration_minutes: durationMin },
    });

    return NextResponse.json({
      ok: true,
      entry_id: updated.id,
      duration_minutes: durationMin,
      stopped_at: now.toISOString(),
    });
  }

  // Default: start
  const parsed = StartSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });

  const { customer_id, va_id, bucket_id, description, basecamp_todo_id } = parsed.data;

  // Resolve bucket
  let bucket = bucket_id
    ? await prisma.bucket.findFirst({ where: { id: bucket_id, status: "active" } })
    : null;
  if (!bucket) {
    bucket = await prisma.bucket.findFirst({
      where: { customer_id, status: "active" },
      orderBy: { rollover_date: "asc" },
    });
  }
  if (!bucket) return NextResponse.json({ error: "No active bucket for this client" }, { status: 400 });

  // Check for existing running timer
  if (va_id) {
    const running = await prisma.timeEntry.findFirst({
      where: {
        va_id,
        customer_id,
        status: "draft",
        end_time: null,
        NOT: { start_time: null },
      },
    });
    if (running) {
      return NextResponse.json(
        { error: `Timer already running (entry_id=${running.id})` },
        { status: 409 }
      );
    }
  }

  const now = new Date();
  const entry = await prisma.timeEntry.create({
    data: {
      bucket_id: bucket.id,
      customer_id,
      va_id: va_id ?? null,
      basecamp_todo_id: basecamp_todo_id ?? null,
      start_time: now,
      duration_minutes: 0,
      description: description ?? null,
      status: "draft",
    },
  });

  return NextResponse.json(
    { ok: true, entry_id: entry.id, started_at: now.toISOString(), bucket_id: bucket.id },
    { status: 201 }
  );
}
