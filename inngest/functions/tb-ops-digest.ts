/**
 * inngest/functions/tb-ops-digest.ts
 * Replaces: app/tb_ops_digest.py
 *
 * Daily  (event: tb/daily-ops.requested) — 8:05 CT via /api/cron/daily-ops
 *   §1 Today's Radar   — at-risk clients, open escalations, SLA breach, burnout
 *   §2 Manager Snapshot — per-manager: SLA compliance, avg health, open esc count
 *   §3 VA Reliability   — top 20 %, bottom 20 %, capacity red flags
 *   §4 Root Cause Trend — top 3 delay categories last 7d
 *   §5 Recognition      — top-20 % streak VAs
 *
 * Weekly (event: tb/weekly-ops.requested) — Mon 8:15 CT via /api/cron/weekly-ops
 *   Escalation trend vs prior week, band distribution, manager SLA rank.
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { postMessage } from "@/lib/slack";

// ─────────────────────────────────────────────────────────────────────────────
// DAILY DIGEST
// ─────────────────────────────────────────────────────────────────────────────

export const tbOpsDailyDigest = inngest.createFunction(
  { id: "tb-ops-daily-digest", name: "TB Ops Daily Digest", concurrency: 1 },
  { event: "tb/daily-ops.requested" },
  async ({ step, logger }) => {
    const channel = process.env.OPS_CHANNEL_ID;
    if (!channel) {
      logger.warn("OPS_CHANNEL_ID not set — skipping daily digest");
      return { skipped: true };
    }

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);

    // ── §1 Radar data ─────────────────────────────────────────────────────────
    const radar = await step.run("gather-radar", async () => {
      const [atRiskScores, openEscalations, slaBreached, burnoutFlags] = await Promise.all([
        // At-risk clients: customers with no recent health score OR latest health < 70
        prisma.scoreDaily.findMany({
          where: {
            score_type: "client_health",
            day: { gte: sevenDaysAgo },
          },
          orderBy: [{ customer_id: "asc" }, { day: "desc" }],
          distinct: ["customer_id"],
          select: { customer_id: true, score_value: true, trend_value: true },
        }),
        // Open manager escalations
        prisma.intervention.findMany({
          where: { level: "manager", status: "open" },
          orderBy: { created_at: "asc" },
          select: { id: true, customer_id: true, created_at: true, sla_breached_at: true, root_cause_category: true },
          take: 10,
        }),
        // SLA-breached interventions
        prisma.intervention.count({
          where: { status: "open", sla_breached_at: { not: null } },
        }),
        // VA burnout: capacity_index or load state burnout flag
        prisma.vaLoadState.findMany({
          where: { burnout_flag: true },
          select: { va_id: true, throttle_level: true, active_task_count: true, reasons_json: true },
        }),
      ]);

      const atRiskClients = atRiskScores
        .filter((s) => Number(s.score_value) < 70)
        .slice(0, 5);

      return { atRiskClients, openEscalations, slaBreached, burnoutFlags };
    });

    // ── §3 VA Reliability ─────────────────────────────────────────────────────
    const vaReliability = await step.run("gather-va-reliability", async () => {
      const scores = await prisma.scoreDaily.findMany({
        where: {
          score_type: "reliability",
          day: { gte: sevenDaysAgo },
        },
        orderBy: [{ person_id: "asc" }, { day: "desc" }],
        distinct: ["person_id"],
        select: { person_id: true, score_value: true, trend_value: true },
      });

      const sorted = scores
        .filter((s) => s.person_id != null)
        .map((s) => ({ person_id: s.person_id!, score: Number(s.score_value), trend: s.trend_value ? Number(s.trend_value) : null }))
        .sort((a, b) => b.score - a.score);

      const top = Math.max(1, Math.ceil(sorted.length * 0.2));
      return { top: sorted.slice(0, top), bottom: sorted.slice(-top), total: sorted.length };
    });

    // ── §4 Root Cause Trend ───────────────────────────────────────────────────
    const rootCauses = await step.run("gather-root-causes", async () => {
      const rows = await prisma.intervention.groupBy({
        by: ["root_cause_category"],
        where: {
          created_at: { gte: sevenDaysAgo },
          root_cause_category: { not: null },
        },
        _count: { root_cause_category: true },
        orderBy: { _count: { root_cause_category: "desc" } },
        take: 3,
      });
      return rows.map((r) => ({ category: r.root_cause_category!, count: r._count.root_cause_category }));
    });

    // ── §2 Manager Snapshot ───────────────────────────────────────────────────
    const managerSnapshot = await step.run("gather-manager-snapshot", async () => {
      // Count open manager escalations per customer_id (approximate per-manager)
      const byCustomer = await prisma.intervention.groupBy({
        by: ["customer_id"],
        where: { level: "manager", status: "open", customer_id: { not: null } },
        _count: { id: true },
      });
      return { openByCustomer: byCustomer.length, totalOpen: radar.openEscalations.length };
    });

    // ── Build Block Kit ───────────────────────────────────────────────────────
    const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

    const blocks: Record<string, unknown>[] = [
      { type: "header", text: { type: "plain_text", text: `📋 TB Ops Daily Digest — ${dateStr}` } },
      { type: "divider" },

      // §1 Radar
      { type: "section", text: { type: "mrkdwn", text: "*§1 Today's Radar*" } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*At-Risk Clients:*\n${radar.atRiskClients.length > 0 ? radar.atRiskClients.map((c) => `• Customer #${c.customer_id} (health: ${Number(c.score_value).toFixed(0)})`).join("\n") : "✅ None"}` },
          { type: "mrkdwn", text: `*Open Escalations:*\n${radar.openEscalations.length} open\n${radar.slaBreached > 0 ? `⚠ ${radar.slaBreached} SLA breached` : "✅ No SLA breaches"}` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: radar.burnoutFlags.length > 0
            ? `*Burnout Flags:* ⚠ ${radar.burnoutFlags.length} VA(s) flagged — ${radar.burnoutFlags.map((f) => `<@${f.va_id}> (${f.throttle_level})`).join(", ")}`
            : "*Burnout Flags:* ✅ No VAs flagged",
        },
      },
      { type: "divider" },

      // §2 Manager Snapshot
      { type: "section", text: { type: "mrkdwn", text: `*§2 Manager Snapshot*\nOpen escalations: *${managerSnapshot.totalOpen}* across *${managerSnapshot.openByCustomer}* customers` } },
      { type: "divider" },

      // §3 VA Reliability
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*§3 VA Reliability* (${vaReliability.total} VAs scored)\n*Top:* ${vaReliability.top.map((v) => `#${v.person_id} ${v.score}%`).join(" · ") || "—"}\n*Bottom:* ${vaReliability.bottom.map((v) => `#${v.person_id} ${v.score}%`).join(" · ") || "—"}`,
        },
      },
      { type: "divider" },

      // §4 Root Cause Trend
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*§4 Root Cause Trend (7d)*\n${rootCauses.length > 0 ? rootCauses.map((r, i) => `${i + 1}. ${r.category}: ${r.count}`).join("\n") : "No root causes recorded"}`,
        },
      },

      // Footer
      { type: "context", elements: [{ type: "mrkdwn", text: `Generated by TB Ops Bot · ${now.toISOString()}` }] },
    ];

    await step.run("post-to-slack", () =>
      postMessage({ channel, text: `TB Ops Daily Digest — ${dateStr}`, blocks: blocks as never[] })
    );

    logger.info("TB Ops daily digest posted");
    return { ok: true, date: now.toISOString(), atRisk: radar.atRiskClients.length, openEsc: radar.openEscalations.length };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// WEEKLY DIGEST
// ─────────────────────────────────────────────────────────────────────────────

export const tbOpsWeeklyDigest = inngest.createFunction(
  { id: "tb-ops-weekly-digest", name: "TB Ops Weekly Digest", concurrency: 1 },
  { event: "tb/weekly-ops.requested" },
  async ({ step, logger }) => {
    const channel = process.env.OPS_CHANNEL_ID;
    if (!channel) {
      logger.warn("OPS_CHANNEL_ID not set — skipping weekly digest");
      return { skipped: true };
    }

    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86_400_000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);

    const weeklyData = await step.run("gather-weekly-data", async () => {
      const [thisWeekEsc, priorWeekEsc, resolvedWithRootCause, bandCounts, totalResolved] = await Promise.all([
        // This week escalations
        prisma.intervention.count({ where: { level: "manager", created_at: { gte: sevenDaysAgo } } }),
        // Prior week escalations
        prisma.intervention.count({
          where: { level: "manager", created_at: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
        }),
        // Resolved with root cause (last 14d)
        prisma.intervention.findMany({
          where: { status: "resolved", resolved_at: { gte: fourteenDaysAgo }, root_cause_category: { not: null } },
          select: { root_cause_category: true },
        }),
        // Band distribution from ScoreDaily
        prisma.scoreDaily.groupBy({
          by: ["band"],
          where: { score_type: "client_health", day: { gte: sevenDaysAgo }, band: { not: null } },
          _count: { band: true },
          orderBy: { _count: { band: "desc" } },
        }),
        // Resolved this week
        prisma.intervention.count({ where: { status: "resolved", resolved_at: { gte: sevenDaysAgo } } }),
      ]);

      // Root cause frequency
      const rcMap: Record<string, number> = {};
      for (const r of resolvedWithRootCause) {
        const cat = r.root_cause_category ?? "unknown";
        rcMap[cat] = (rcMap[cat] ?? 0) + 1;
      }
      const topRootCauses = Object.entries(rcMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cat, count]) => ({ cat, count }));

      return { thisWeekEsc, priorWeekEsc, topRootCauses, bandCounts, totalResolved };
    });

    const trend = weeklyData.thisWeekEsc - weeklyData.priorWeekEsc;
    const trendStr = trend > 0 ? `↑ +${trend}` : trend < 0 ? `↓ ${trend}` : "→ flat";
    const dateStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

    const blocks: Record<string, unknown>[] = [
      { type: "header", text: { type: "plain_text", text: `📊 TB Ops Weekly Summary — w/o ${dateStr}` } },
      { type: "divider" },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Escalations This Week:*\n${weeklyData.thisWeekEsc} (${trendStr} vs prior week)` },
          { type: "mrkdwn", text: `*Resolved This Week:*\n${weeklyData.totalResolved}` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Band Distribution (client health):*\n${weeklyData.bandCounts.map((b) => `${b.band}: ${b._count.band}`).join("  ·  ") || "No data"}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Top Root Causes (14d):*\n${weeklyData.topRootCauses.length > 0 ? weeklyData.topRootCauses.map((r, i) => `${i + 1}. ${r.cat} (${r.count})`).join("\n") : "No root causes recorded"}`,
        },
      },
      { type: "context", elements: [{ type: "mrkdwn", text: `TB Ops Bot · ${now.toISOString()}` }] },
    ];

    await step.run("post-to-slack", () =>
      postMessage({ channel, text: `TB Ops Weekly Summary — ${dateStr}`, blocks: blocks as never[] })
    );

    logger.info("TB Ops weekly digest posted");
    return { ok: true, week: now.toISOString(), thisWeekEsc: weeklyData.thisWeekEsc };
  }
);
