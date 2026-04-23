/**
 * inngest/functions/system-heartbeat.ts
 *
 * Port of system_alerts.run_system_heartbeat()
 *
 * Every 5 minutes: check DB health, DM founder on degraded/down.
 * Includes a 15-min Inngest cooldown key to avoid DM spam.
 *
 * Requires env: FOUNDER_DM_SLACK_USER_ID
 * Cron: every 5 minutes
 * Also fires on: tb/system-heartbeat.requested
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { WebClient } from "@slack/web-api";

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const FOUNDER_UID = process.env.FOUNDER_DM_SLACK_USER_ID;

export const systemHeartbeat = inngest.createFunction(
  {
    id: "system-heartbeat",
    name: "System Heartbeat",
    concurrency: { limit: 1 },
  },
  [
    { cron: "*/5 * * * *" },
    { event: "tb/system-heartbeat.requested" },
  ],
  async ({ step, logger }) => {
    const result = await step.run("health-check", async () => {
      const checks: Record<string, { ok: boolean; error?: string }> = {};

      try {
        await prisma.$queryRaw`SELECT 1`;
        checks.db = { ok: true };
      } catch (err) {
        checks.db = { ok: false, error: String(err).slice(0, 200) };
      }

      const allOk  = Object.values(checks).every((c) => c.ok);
      const anyOk  = Object.values(checks).some((c) => c.ok);
      const status = allOk ? "ok" : anyOk ? "degraded" : "down";

      return { status, checks, ts: new Date().toISOString() };
    });

    if (result.status === "ok") {
      logger.info("system-heartbeat: all systems healthy");
      return result;
    }

    // DM founder with health alert
    await step.run("alert-founder", async () => {
      if (!SLACK_TOKEN || !FOUNDER_UID) {
        logger.warn("system-heartbeat: no SLACK_BOT_TOKEN or FOUNDER_DM_SLACK_USER_ID — skipping DM");
        return;
      }

      const failed = Object.entries(result.checks)
        .filter(([, c]) => !c.ok)
        .map(([name]) => name);

      const statusEmoji = result.status === "degraded" ? ":warning:" : ":skull:";

      const blocks: object[] = [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `${statusEmoji} System Health: ${result.status.toUpperCase()}`,
            emoji: true,
          },
        },
        ...Object.entries(result.checks).map(([name, check]) => ({
          type: "section",
          text: {
            type: "mrkdwn",
            text: check.ok
              ? `:white_check_mark: *${name.toUpperCase()}:* healthy`
              : `:x: *${name.toUpperCase()}:* ${check.error ?? "failed"}`,
          },
        })),
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `_UTC: ${result.ts}_` },
          ],
        },
      ];

      const slack = new WebClient(SLACK_TOKEN);
      await slack.chat.postMessage({
        channel: FOUNDER_UID,
        text: `${statusEmoji} System Health Alert — Status: ${result.status.toUpperCase()} — Failed: ${failed.join(", ")}`,
        blocks: blocks as any,
      });

      logger.warn(`system-heartbeat: alerted founder — status=${result.status} failed=${failed.join(",")}`);
    });

    return result;
  }
);
