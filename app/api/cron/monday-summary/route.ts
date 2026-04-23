import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-guard";
import { inngest } from "@/inngest/client";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await inngest.send({ name: "tb/monday-summary.requested", data: {} });
  return NextResponse.json({ triggered: true });
}
