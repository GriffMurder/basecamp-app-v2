/**
 * Monday Summary — weekly ops summary posted every Monday at 14:00 UTC (09:00 CT)
 *
 * Sections:
 *   🎯 At-Risk Clients    — clients with ≥2 open escalations this week
 *   📊 Sentiment Trends   — aggregate quality signals (praise/revision/negative) last 7d
 *   🔁 Top Rework Reasons — most common root_cause_category from resolved interventions
 *   🏆 VA Leaderboard     — top VAs by intervention resolution rate last 7d
 *   🚨 Open Escalations   — count of unresolved interventions by level
 *
 * Fires Mon 14:00 UTC via cron + on event `tb/monday-summary.requested`.
 */
import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { WebClient } from "@slack/web-api";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export const mondaySummary = inngest.createFunction(
  {
    id: "monday-weekly-summary",
    name: "Monday: Weekly Ops Summary",
    concurrency: { limit: 1 },
  },
  [{ cron: "0 14 * * 1" }, { event: "tb/monday-summary.requested" }],
  async ({ step }) => {
    const channelId = process.env.OPS_CHANNEL_ID;
    if (!channelId) {
      return { skipped: true, reason: "OPS_CHANNEL_ID not set" };
    }

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // ── At-Risk Clients ──────────────────────────────────────────────────────
    const atRiskClients = await step.run("at-risk-clients", async () => {
      return prisma.intervention.groupBy({
        by: ["customer_id"],
        where: {
          status: "open",
          created_at: { gte: weekAgo },
          customer_id: { not: null },
        },
        _count: { id: true },
        having: { id: { _count: { gte: 2 } } },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      });
    });

    const atRiskCustomerIds = atRiskClients
      .filter((r) => r.customer_id !== null)
      .map((r) => r.customer_id as number);

    const atRiskNames = await step.run("at-risk-client-names", async () => {
      if (atRiskCustomerIds.length === 0) return [];
      return prisma.customer.findMany({
        where: { id: { in: atRiskCustomerIds } },
        select: { id: true, name: true, effective_tier: true },
      });
    });

    const clientCountMap = new Map(
      atRiskClients.map((r) => [r.customer_id, r._count.id])
    );

    // ── Quality signals / Sentiment ──────────────────────────────────────────
    const qualitySignals = await step.run("quality-signals", async () => {
      return prisma.taskQualityEvent.groupBy({
        by: ["event_type"],
        where: { created_at: { gte: weekAgo } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
      });
    });

    // ── Top Rework Reasons ───────────────────────────────────────────────────
    const reworkReasons = await step.run("rework-reasons", async () => {
      return prisma.intervention.groupBy({
        by: ["root_cause_category"],
        where: {
          status: "resolved",
          resolved_at: { gte: weekAgo },
          root_cause_category: { not: null },
        },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 5,
      });
    });

    // ── VA Leaderboard ───────────────────────────────────────────────────────
    const vaStats = await step.run("va-leaderboard", async () => {
      const resolved = await prisma.intervention.groupBy({
        by: ["target_person_id"],
        where: {
          level: "va",
          status: "resolved",
          resolved_at: { gte: weekAgo },
          target_person_id: { not: null },
        },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 5,
      });
      const sent = await prisma.intervention.groupBy({
        by: ["target_person_id"],
        where: {
          level: "va",
          created_at: { gte: weekAgo },
          target_person_id: { not: null },
        },
        _count: { id: true },
      });
      const sentMap = new Map(sent.map((r) => [r.target_person_id, r._count.id]));
      return resolved.map((r) => ({
        person_id: r.target_person_id!,
        resolved: r._count.id,
        sent: sentMap.get(r.target_person_id!) ?? r._count.id,
        rate: sentMap.get(r.target_person_id!)
          ? Math.round((r._count.id / sentMap.get(r.target_person_id!)!) * 100)
          : 100,
      }));
    });

    // ── Open Escalations by Level ────────────────────────────────────────────
    const openByLevel = await step.run("open-escalations", async () => {
      return prisma.intervention.groupBy({
        by: ["level"],
        where: { status: "open" },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
      });
    });

    // ── Build Slack blocks ───────────────────────────────────────────────────
    await step.run("post-to-slack", async () => {
      const blocks: object[] = [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "📊  Weekly Ops Summary",
            emoji: true,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Week of ${weekAgo.toLocaleDateString("en-US", { month: "short", day: "numeric" })} — ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
            },
          ],
        },
        { type: "divider" },
      ];

      // At-Risk Clients
      {
        const lines =
          atRiskNames.length === 0
            ? ["✅ No clients flagged at-risk this week."]
            : atRiskNames.map(
                (c) =>
                  `• *${c.name}* (Tier ${c.effective_tier ?? "?"}) — ${clientCountMap.get(c.id) ?? 0} open escalations`
              );
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `*🎯 At-Risk Clients*\n${lines.join("\n")}` },
        });
        blocks.push({ type: "divider" });
      }

      // Quality Signals / Sentiment
      {
        const total = qualitySignals.reduce((s, r) => s + r._count.id, 0);
        const lines =
          qualitySignals.length === 0
            ? ["No quality events recorded this week."]
            : qualitySignals.map((r) => `• ${r.event_type}: *${r._count.id}*`);
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*📊 Quality Signals* (${total} events)\n${lines.join("\n")}`,
          },
        });
        blocks.push({ type: "divider" });
      }

      // Top Rework Reasons
      {
        const lines =
          reworkReasons.length === 0
            ? ["No resolved escalations with root cause this week."]
            : reworkReasons.map((r) => `• ${r.root_cause_category}: *${r._count.id}*`);
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `*🔁 Top Rework Reasons*\n${lines.join("\n")}` },
        });
        blocks.push({ type: "divider" });
      }

      // VA Leaderboard
      {
        const lines =
          vaStats.length === 0
            ? ["No VA intervention data this week."]
            : vaStats.map(
                (v) =>
                  `• ID \`${v.person_id.slice(-6)}\` — ${v.resolved}/${v.sent} resolved (${v.rate}%)`
              );
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `*🏆 VA Leaderboard* (nudge response rate)\n${lines.join("\n")}` },
        });
        blocks.push({ type: "divider" });
      }

      // Open Escalations
      {
        const total = openByLevel.reduce((s, r) => s + r._count.id, 0);
        const lines =
          openByLevel.length === 0
            ? ["No open escalations."]
            : openByLevel.map((r) => `• ${r.level}: *${r._count.id}*`);
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*🚨 Open Escalations* (${total} total)\n${lines.join("\n")}`,
          },
        });
      }

      blocks.push({ type: "divider" });
      blocks.push({
        type: "context",
        elements: [
          { type: "mrkdwn", text: "_Generated by AI Wesley · Last 7 days_" },
        ],
      });

      await slack.chat.postMessage({
        channel: channelId,
        text: "📊 Weekly Ops Summary — see thread for details.",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        blocks: blocks as any,
      });
    });

    return {
      ok: true,
      atRisk: atRiskNames.length,
      qualityEvents: qualitySignals.reduce((s, r) => s + r._count.id, 0),
      openEscalations: openByLevel.reduce((s, r) => s + r._count.id, 0),
    };
  }
);
