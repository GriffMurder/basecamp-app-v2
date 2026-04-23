/**
 * app/api/healthz/route.ts
 *
 * Port of system_alerts.deep_health_check()
 *
 * GET /api/healthz
 * Returns:
 *   200  { status: "ok",       checks: { db: { ok: true } }, ts: "..." }
 *   503  { status: "degraded" | "down", checks: { db: { ok: false, error: "..." } }, ts: "..." }
 *
 * Note: In Next.js we only check DB. Redis/Celery are not applicable.
 */
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, { ok: boolean; error?: string }> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = { ok: true };
  } catch (err) {
    checks.db = { ok: false, error: String(err).slice(0, 200) };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  const anyOk = Object.values(checks).some((c) => c.ok);
  const status = allOk ? "ok" : anyOk ? "degraded" : "down";

  return NextResponse.json(
    { status, checks, ts: new Date().toISOString() },
    { status: allOk ? 200 : 503 }
  );
}
