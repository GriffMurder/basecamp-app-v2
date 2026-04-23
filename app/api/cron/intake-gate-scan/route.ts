/**
 * app/api/cron/intake-gate-scan/route.ts
 * POST /api/cron/intake-gate-scan — triggers the intake-gate-scan Inngest fn.
 * Called by Vercel Cron (every hour).
 */
import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export async function POST(req: Request) {
  const secret = req.headers.get("x-cron-secret") ?? "";
  if (secret !== (process.env.CRON_SECRET ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await inngest.send({ name: "inngest/function.invoked", data: { function_id: "intake-gate-scan" } });
  return NextResponse.json({ ok: true });
}