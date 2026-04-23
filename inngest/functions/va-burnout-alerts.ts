/**
 * inngest/functions/va-burnout-alerts.ts
 * Replaces: app/va_burnout_alerts.py
 *
 * Runs daily (cron 08:10 UTC Mon-Fri).
 * Also triggered by event: tb/burnout-check.requested
 *
 * Checks VaLoadState for hard_throttle / burnout_flag VAs and posts
 * a structured alert to OPS_CHANNEL_ID (manager-visible, internal).
 *
 * Dedup: skips VAs already alerted in the last 24h (flags checked via
 * VaLoadState.updated_at — if burnout_flag is true and updated recently).
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { postMessage } from "@/lib/slack";

export const vaBurnoutAlerts = inngest.createFunction(
  { id: "va-burnout-alerts", name: "VA Burnout Alerts", concurrency: 1 },
  [
    { cron: "10 8 * * 1-5" }, // Mon-Fri 08:10 UTC
    { event: "tb/burnout-check.requested" },
  ],
  async ({ step, logger }) => {
    const channel = process.env.OPS_CHANNEL_ID;
    if (!channel) {
      logger.warn("OPS_CHANNEL_ID not set — skipping burnout alerts");
      return { skipped: true };
    }

    // ── Load flagged VAs ──────────────────────────────────────────────────────
    const flagged = await step.run("load-burnout-flags", () =>
      prisma.vaLoadState.findMany({
        where: {
          OR: [
            { burnout_flag: true },
            { throttle_level: "hard_throttle" },
          ],
        },
        select: {
          va_id: true,
          throttle_level: true,
          burnout_flag: true,
          active_task_count: true,
          reasons_json: true,
          updated_at: true,
        },
      })
    );

    if (flagged.length === 0) {
      logger.info("No VA burnout flags — nothing to post");
      return { alerted: 0 };
    }

    // Dedup: only alert if updated in last 25h (fresh flag)
    const cutoff = new Date(Date.now() - 25 * 3_600_000);
    const recent = flagged.filter(
      (f) => f.updated_at && new Date(f.updated_at) >= cutoff
    );

    if (recent.length === 0) {
      logger.info("All burnout flags are stale — skipping");
      return { alerted: 0, stale: flagged.length };
    }

    // ── Post per-VA alert ─────────────────────────────────────────────────────
    // VaLoadState.va_id is a UUID computed by the Python app — it does not
    // map to Va.id (Int). We use the UUID as the display identifier.
    let alerted = 0;
    for (const flag of recent) {
      const name = `VA ${flag.va_id.substring(0, 8)}`;
      const slackId = null; // VaLoadState.va_id is a UUID, not a Slack user ID
      const reasons = Array.isArray(flag.reasons_json) ? (flag.reasons_json as string[]) : [];
      const throttleLabel =
        flag.throttle_level === "hard_throttle" ? ":red_circle: Hard Throttle" :
        flag.throttle_level === "soft_throttle" ? ":large_yellow_circle: Soft Throttle" : flag.throttle_level ?? "—";

      const header = flag.burnout_flag
        ? `⚠️ VA Burnout Alert — ${name}${slackId ? ` (<@${slackId}>)` : ""}`
        : `⚠️ VA Overload Alert — ${name}${slackId ? ` (<@${slackId}>)` : ""}`;

      const blocks: Record<string, unknown>[] = [
        { type: "header", text: { type: "plain_text", text: header } },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Throttle Level:*\n${throttleLabel}` },
            { type: "mrkdwn", text: `*Active Tasks:*\n${flag.active_task_count ?? "—"}` },
          ],
        },
        reasons.length > 0
          ? {
              type: "section",
              text: { type: "mrkdwn", text: `*Signals:*\n${reasons.map((r) => `• ${r}`).join("\n")}` },
            }
          : null,
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*Suggested Actions:*\n• *Rebalance tasks* — reassign 1–2 active tasks to a less-loaded VA\n• *Schedule a check-in* — DM the VA directly to discuss workload\n• *Swap high-risk client tasks* — protect client relationships from burnout risk",
          },
        },
        { type: "context", elements: [{ type: "mrkdwn", text: `VA Load State updated: ${flag.updated_at ? new Date(flag.updated_at).toLocaleString() : "unknown"}` }] },
      ].filter(Boolean) as Record<string, unknown>[];

      await step.run(`alert-va-${flag.va_id.substring(0, 8)}`, () =>
        postMessage({ channel, text: header, blocks: blocks as never[] })
      );

      alerted++;
    }

    logger.info(`VA burnout alerts sent: ${alerted}`);
    return { alerted, total_flagged: flagged.length };
  }
);
