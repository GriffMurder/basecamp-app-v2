import { inngest } from "@/inngest/client";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    const query = new URL(req.url).searchParams.get("secret") ?? "";
    if (auth !== `Bearer ${secret}` && query !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  await inngest.send({ name: "tb/va-personalized-nudges.requested", data: {} });
  return NextResponse.json({ triggered: true, event: "tb/va-personalized-nudges.requested" });
}
