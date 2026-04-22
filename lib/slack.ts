/**
 * lib/slack.ts
 * Slack WebAPI client wrapper — thin helpers around @slack/web-api.
 *
 * All public functions create a short-lived WebClient per call so
 * that the bot token can be rotated without restarting the server.
 */

import { WebClient, LogLevel } from "@slack/web-api";
import type { Block, KnownBlock } from "@slack/web-api";

function client(): WebClient {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is not set");
  return new WebClient(token, {
    logLevel: process.env.NODE_ENV === "development" ? LogLevel.DEBUG : LogLevel.ERROR,
  });
}

// ── Messaging ─────────────────────────────────────────────────────────────────

/** Post a plain-text or Block Kit message to a channel. */
export async function postMessage(params: {
  channel: string;
  text: string;
  blocks?: (Block | KnownBlock)[];
  thread_ts?: string;
}): Promise<{ ts: string; channel: string }> {
  const result = await client().chat.postMessage(params);
  return { ts: result.ts!, channel: result.channel! };
}

/** Update an existing message in place. */
export async function updateMessage(params: {
  channel: string;
  ts: string;
  text: string;
  blocks?: (Block | KnownBlock)[];
}): Promise<void> {
  await client().chat.update(params);
}

/** Delete a message. */
export async function deleteMessage(channel: string, ts: string): Promise<void> {
  await client().chat.delete({ channel, ts });
}

/** Send a direct message (opens DM if needed). */
export async function sendDM(userId: string, text: string, blocks?: (Block | KnownBlock)[]): Promise<string | null> {
  const slack = client();
  const { channel } = await slack.conversations.open({ users: userId });
  if (!channel?.id) return null;
  const result = await slack.chat.postMessage({ channel: channel.id, text, ...(blocks ? { blocks } : {}) });
  return result.ts ?? null;
}

// ── User lookup ───────────────────────────────────────────────────────────────

/** Look up a Slack user by email address. Returns null if not found. */
export async function findUserByEmail(email: string): Promise<{
  id: string;
  name: string;
  real_name: string;
  profile: { email: string; display_name: string };
} | null> {
  try {
    const result = await client().users.lookupByEmail({ email });
    return (result.user as { id: string; name: string; real_name: string; profile: { email: string; display_name: string } }) ?? null;
  } catch {
    return null;
  }
}

/** Get a user's profile. */
export async function getUserProfile(userId: string): Promise<{
  email: string;
  display_name: string;
  real_name: string;
} | null> {
  try {
    const result = await client().users.profile.get({ user: userId });
    const p = result.profile;
    if (!p) return null;
    return {
      email: (p as Record<string, string>).email ?? "",
      display_name: (p as Record<string, string>).display_name ?? "",
      real_name: (p as Record<string, string>).real_name ?? "",
    };
  } catch {
    return null;
  }
}

// ── Channels ──────────────────────────────────────────────────────────────────

/** Post to ops channel (OPS_CHANNEL_ID). */
export async function postToOps(text: string, blocks?: (Block | KnownBlock)[]): Promise<string | null> {
  const channel = process.env.OPS_CHANNEL_ID;
  if (!channel) return null;
  const result = await postMessage({ channel, text, blocks });
  return result.ts;
}

/** Post to job board channel (JOB_BOARD_CHANNEL_ID). */
export async function postToJobBoard(text: string, blocks?: (Block | KnownBlock)[]): Promise<string | null> {
  const channel = process.env.JOB_BOARD_CHANNEL_ID;
  if (!channel) return null;
  const result = await postMessage({ channel, text, blocks });
  return result.ts;
}

// ── Signature verification ────────────────────────────────────────────────────

/**
 * Verify an incoming Slack request signature.
 * Call this at the start of any Slack webhook/actions route.
 */
export async function verifySlackSignature(req: Request): Promise<boolean> {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return false;

  const ts = req.headers.get("x-slack-request-timestamp");
  const sig = req.headers.get("x-slack-signature");
  if (!ts || !sig) return false;

  // Reject timestamps older than 5 minutes
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;

  const body = await req.text();
  const baseStr = `v0:${ts}:${body}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig_bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(baseStr));
  const computed = "v0=" + Array.from(new Uint8Array(sig_bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return computed === sig;
}