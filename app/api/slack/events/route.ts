/**
 * POST /api/slack/events
 * Slack Events API endpoint.
 * Handles: url_verification challenge + message/reaction events.
 */
import { NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  // Clone so we can read body twice
  const cloned = req.clone();
  const isValid = await verifySlackSignature(cloned);
  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const body = await req.json() as {
    type: string;
    challenge?: string;
    event?: {
      type: string;
      text?: string;
      user?: string;
      channel?: string;
      ts?: string;
      thread_ts?: string;
      bot_id?: string;
    };
  };

  // URL verification handshake
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

  // Ignore bot messages
  if (body.event?.bot_id) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}