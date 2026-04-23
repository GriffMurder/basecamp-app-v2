/**
 * inngest/functions/sentiment-scan.ts
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Daily sentiment scan — ports check_sentiment_dip_alerts() from sentiment.py.
 *
 * Steps:
 * 1. Find recent customer comments from basecamp_thread_activity (last 24h)
 * 2. Run analyseSentiment() on each unscored comment
 * 3. Log sentiment result into `interactions` table
 * 4. Run checkSentimentDipAlerts() across all active clients
 * 5. Post dip alerts to Ops Slack channel
 * 6. Record sentiment_dip_alert interaction to enforce cooldown
 *
 * Cron: 07:30 UTC daily (after scrub at 06:00 UTC)
 * Also handles: tb/sentiment-scan.trigger (manual)
 */

import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { analyseSentiment, checkSentimentDipAlerts, formatSentimentLabel } from "@/lib/sentiment";
import { logInteraction } from "@/lib/interaction-logger";
import { postToOps } from "@/lib/slack";

export const sentimentScan = inngest.createFunction(
  {
    id: "sentiment-scan",
    name: "Sentiment Scan — Daily Customer Comment Scoring + Dip Alerts",
    concurrency: 1,
  },
  [
    { cron: "30 7 * * *" }, // 07:30 UTC daily
    { event: "tb/sentiment-scan.trigger" },
  ],
  async ({ step, logger }) => {
    // ── Step 1: Collect recent unscored customer comments ─────────────────
    const recentComments = await step.run("load-recent-comments", async () => {
      const since = new Date(Date.now() - 24 * 3600_000);
      const rows = await prisma.basecampThreadActivity.findMany({
        where: {
          last_customer_at: { gte: since },
          last_customer_text: { not: null },
        },
        select: {
          id: true,
          basecamp_project_id: true,
          last_customer_text: true,
          last_customer_at: true,
          basecamp_todo_id: true,
        },
        take: 200,
        orderBy: { last_customer_at: "desc" },
      });
      return rows;
    });

    // ── Step 2: Resolve customer_ids and score comments ───────────────────
    let scored = 0;
    let skipped = 0;

    for (let i = 0; i < recentComments.length; i += 10) {
      const batch = recentComments.slice(i, i + 10);
      const batchResult = await step.run(`score-batch-${i}`, async () => {
        let batchScored = 0;
        for (const row of batch) {
          if (!row.last_customer_text || !row.basecamp_project_id) continue;

          // Resolve customer_id from project
          const customer = await prisma.customer.findFirst({
            where: { basecamp_project_id: row.basecamp_project_id },
            select: { id: true },
          });
          if (!customer) continue;

          // Check if already scored for this BTA row
          const lastAt = row.last_customer_at ? new Date(row.last_customer_at.toString()) : new Date();
          const alreadyScored = await prisma.interaction.findFirst({
            where: {
              customer_id: customer.id,
              interaction_type: "customer_comment_sentiment",
              todo_id: row.basecamp_todo_id ?? undefined,
              happened_at: {
                gte: new Date(lastAt.getTime() - 60_000),
                lte: new Date(lastAt.getTime() + 60_000),
              },
            },
            select: { id: true },
          });
          if (alreadyScored) continue;

          // Analyse sentiment
          const result = await analyseSentiment(row.last_customer_text);
          if (!result) continue;

          // Log to interactions
          await logInteraction({
            source: "sentiment_scan",
            interaction_type: "customer_comment_sentiment",
            happened_at: lastAt,
            customer_id: customer.id,
            todo_id: row.basecamp_todo_id ?? null,
            payload: {
              sentiment_label: result.label,
              sentiment_score: result.score,
              sentiment_key_quote: result.key_quote,
              comment_snippet: row.last_customer_text.slice(0, 200),
            },
          });
          batchScored++;
        }
        return batchScored;
      });
      scored += batchResult;
      skipped += batch.length - batchResult;
    }

    logger.info(`Sentiment scoring complete: scored=${scored} skipped=${skipped}`);

    // ── Step 3: Run dip detection across all clients ───────────────────────
    const dipAlerts = await step.run("dip-detection", async () => {
      return checkSentimentDipAlerts();
    });

    // ── Step 4: Post dip alerts to Ops Slack ──────────────────────────────
    let alertsPosted = 0;
    for (const alert of dipAlerts) {
      await step.run(`post-alert-${alert.customer_id}`, async () => {
        const trendEmoji =
          alert.trend === "improving" ? "📈"
          : alert.trend === "declining" ? "📉"
          : "➡️";

        const quoteSection = alert.latest_key_quote
          ? `\n> _"${alert.latest_key_quote}"_` : "";

        const text =
          `⚠️ *Client Sentiment Alert — ${alert.customer_name}*\n` +
          `Avg score: \`${alert.avg_score != null ? alert.avg_score.toFixed(2) : "N/A"}\`  |  ` +
          `Negatives: \`${alert.negative_count}\`  |  Trend: ${trendEmoji} ${alert.trend ?? "unknown"}\n` +
          `Reason: ${alert.alert_reason}${quoteSection}`;

        await postToOps(text);

        // Record cooldown interaction
        await logInteraction({
          source: "sentiment_scan",
          interaction_type: "sentiment_dip_alert",
          happened_at: new Date(),
          customer_id: alert.customer_id,
          payload: {
            alert_reason: alert.alert_reason,
            avg_score: alert.avg_score,
            trend: alert.trend,
          },
        });
        alertsPosted++;
      });
    }

    return {
      scored,
      skipped,
      dip_alerts_posted: alertsPosted,
      comments_evaluated: recentComments.length,
    };
  }
);