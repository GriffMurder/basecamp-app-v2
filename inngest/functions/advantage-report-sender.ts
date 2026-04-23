/**
 * inngest/functions/advantage-report-sender.ts
 *
 * Port of app/report_sender.py — Phase 6 Step 7.
 *
 * Sends rendered AdvantageReport rows via Slack:
 *   client_monthly → POST to Customer.slack_channel_id
 *   va_monthly     → DM to Va.slack_user_id
 *
 * Only rows with status="rendered" are eligible.
 * Updates status to "sent" on delivery, "failed" on error.
 * Idempotent: "sent" rows are skipped automatically.
 *
 * Cron: 2nd of each month at 15:30 UTC (after report builder runs on 1st)
 * Event: tb/advantage-report-sender.trigger
 *
 * Env:
 *   SLACK_BOT_TOKEN           – required for delivery
 *   NEXT_PUBLIC_APP_URL       – used for "View Report" button URL
 */

import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { postMessage, sendDM } from "@/lib/slack";

const MAX_PER_RUN = parseInt(process.env.REPORT_SENDER_MAX_PER_RUN ?? "50");

// ── URL helper ─────────────────────────────────────────────────────────────

function reportUrl(reportId: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return `${base}/admin/advantage-reports/${reportId}`;
}

// ── Slack Block Kit helpers ────────────────────────────────────────────────

type SlackBlock = Record<string, unknown>;

function divider(): SlackBlock {
  return { type: "divider" };
}

function section(mrkdwn: string): SlackBlock {
  return { type: "section", text: { type: "mrkdwn", text: mrkdwn } };
}

function contextBlock(mrkdwn: string): SlackBlock {
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text: mrkdwn }],
  };
}

function buttonSection(label: string, url: string, fallbackText: string): SlackBlock {
  return {
    type: "section",
    text: { type: "mrkdwn", text: fallbackText },
    accessory: {
      type: "button",
      text: { type: "plain_text", text: label, emoji: true },
      url,
      action_id: "view_report",
    },
  };
}

// ── Client monthly blocks ──────────────────────────────────────────────────

interface ClientMetrics {
  customer_name?: string;
  effective_tier?: string;
  tasks_completed?: number;
  avg_turnaround_hours?: number | null;
  first_pass_quality_rate?: number | null;
  client_health_score?: number | null;
  payroll_waste_avoided?: { amount_usd?: number } | null;
}

interface ReportNarrative {
  headline?: string;
  wins?: string[];
  summary?: string;
  positioning_line?: string;
}

function buildClientBlocks(
  metrics: ClientMetrics,
  narrative: ReportNarrative,
  reportId: string,
  periodLabel: string
): { fallback: string; blocks: SlackBlock[] } {
  const name       = metrics.customer_name ?? "Client";
  const tier       = metrics.effective_tier ?? "";
  const tasks      = metrics.tasks_completed ?? 0;
  const turnaround = metrics.avg_turnaround_hours ?? null;
  const quality    = metrics.first_pass_quality_rate ?? null;
  const health     = metrics.client_health_score ?? null;
  const headline   = narrative.headline ?? "";
  const wins       = narrative.wins ?? [];
  const payroll    = metrics.payroll_waste_avoided?.amount_usd ?? 0;
  const url        = reportUrl(reportId);

  const tierBadge  = tier ? ` · ${tier}` : "";
  const qualityStr = quality != null ? `${Math.round(quality * 100)}%` : "—";
  const taStr      = turnaround != null ? `${turnaround.toFixed(1)}h` : "—";
  const healthStr  = health != null ? String(health) : "—";
  const payrollStr = payroll > 0 ? `$${payroll.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—";

  const winsText = wins
    .slice(0, 3)
    .map((w) => `• ${w}`)
    .join("\n");

  const fallback = `[${periodLabel}] ${name} Advantage Report — ${tasks} tasks · Quality ${qualityStr}`;

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `📊 ${name} — ${periodLabel} Advantage Report`,
        emoji: true,
      },
    },
    divider(),
    section(headline ? `_${headline}_` : `_${name}'s ${periodLabel} report is ready._`),
    divider(),
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Tasks Completed*\n${tasks}` },
        { type: "mrkdwn", text: `*Avg Turnaround*\n${taStr}` },
        { type: "mrkdwn", text: `*First-Pass Quality*\n${qualityStr}` },
        { type: "mrkdwn", text: `*Health Score*\n${healthStr}` },
      ],
    },
  ];

  if (winsText) {
    blocks.push(divider(), section(`*Wins this month*\n${winsText}`));
  }

  if (payroll > 0) {
    blocks.push(section(`💰 *Estimated payroll waste avoided:* ${payrollStr}`));
  }

  blocks.push(
    divider(),
    buttonSection("View Full Report", url, "View the full report on the dashboard."),
    contextBlock(`TaskBullet · ${name}${tierBadge} · ${periodLabel}`)
  );

  return { fallback, blocks };
}

// ── VA monthly blocks ──────────────────────────────────────────────────────

interface VaMetrics {
  va_name?: string;
  tasks_completed?: number;
  avg_turnaround_hours?: number | null;
  revision_rate?: number | null;
  praise_count?: number;
  stability_score?: number | null;
  positioning_line?: string;
}

function buildVaBlocks(
  metrics: VaMetrics,
  narrative: ReportNarrative,
  reportId: string,
  periodLabel: string
): { fallback: string; blocks: SlackBlock[] } {
  const name        = metrics.va_name ?? "VA";
  const tasks       = metrics.tasks_completed ?? 0;
  const turnaround  = metrics.avg_turnaround_hours ?? null;
  const revRate     = metrics.revision_rate ?? null;
  const praiseCount = metrics.praise_count ?? 0;
  const stability   = metrics.stability_score ?? null;
  const headline    = narrative.headline ?? "";
  const wins        = narrative.wins ?? [];
  const positioning = metrics.positioning_line ?? "";
  const url         = reportUrl(reportId);

  const taStr   = turnaround != null ? `${turnaround.toFixed(1)}h` : "—";
  const revStr  = revRate != null ? `${(revRate * 100).toFixed(1)}%` : "—";
  const stabStr = stability != null ? String(stability) : "—";

  const winsText = wins
    .slice(0, 3)
    .map((w) => `• ${w}`)
    .join("\n");

  const fallback = `[${periodLabel}] ${name} Performance Report — ${tasks} tasks · Stability ${stabStr}`;

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🏆 Hi ${name} — Your ${periodLabel} Performance Report`,
        emoji: true,
      },
    },
    divider(),
    section(headline ? `_${headline}_` : `_Your ${periodLabel} report is ready._`),
    divider(),
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Tasks Completed*\n${tasks}` },
        { type: "mrkdwn", text: `*Avg Turnaround*\n${taStr}` },
        { type: "mrkdwn", text: `*Revision Rate*\n${revStr}` },
        { type: "mrkdwn", text: `*Praise Received*\n${praiseCount}` },
      ],
    },
    section(`*Stability Score:* ${stabStr} / 100`),
  ];

  if (winsText) {
    blocks.push(divider(), section(`*Wins this month*\n${winsText}`));
  }

  if (positioning) {
    blocks.push(section(`_${positioning}_`));
  }

  blocks.push(
    divider(),
    buttonSection("View My Report", url, "View your full performance report."),
    contextBlock(`TaskBullet · ${name} · ${periodLabel}`)
  );

  return { fallback, blocks };
}

// ── Period label helper ────────────────────────────────────────────────────

function periodLabel(periodStart: Date): string {
  return new Date(periodStart.toString()).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ── Inngest function ────────────────────────────────────────────────────────

export const advantageReportSender = inngest.createFunction(
  {
    id: "advantage-report-sender",
    name: "Advantage Report Sender",
    concurrency: { limit: 1 },
  },
  [
    { cron: "30 15 2 * *" }, // 2nd of each month, 15:30 UTC
    { event: "tb/advantage-report-sender.trigger" },
  ],
  async ({ step, logger }) => {
    // Step 1: find rendered reports
    const reports = await step.run("find-rendered-reports", async () => {
      return prisma.advantageReport.findMany({
        where: { status: "rendered" },
        select: {
          id: true,
          report_type: true,
          subject_id: true,
          period_start: true,
          metrics_json: true,
          narrative_json: true,
        },
        orderBy: { created_at: "asc" },
        take: MAX_PER_RUN,
      });
    });

    if (!reports.length) {
      logger.info("advantage-report-sender: no rendered reports to send");
      return { sent: 0, skipped: 0, failed: 0 };
    }

    logger.info(`advantage-report-sender: ${reports.length} rendered reports to send`);

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const report of reports) {
      const result = await step.run(`send-${report.id}`, async () => {
        const metrics   = (report.metrics_json   ?? {}) as Record<string, unknown>;
        const narrative = (report.narrative_json  ?? {}) as ReportNarrative;
        const label     = periodLabel(new Date(report.period_start.toString()));

        try {
          if (report.report_type === "client_monthly") {
            // Resolve Customer.slack_channel_id from customer_id in metrics_json
            const customerId = typeof metrics.customer_id === "number"
              ? metrics.customer_id
              : null;

            if (!customerId) {
              return { action: "skipped" as const, reason: "no_customer_id_in_metrics" };
            }

            const customer = await prisma.customer.findUnique({
              where: { id: customerId },
              select: { slack_channel_id: true, name: true },
            });

            if (!customer?.slack_channel_id) {
              return { action: "skipped" as const, reason: "no_slack_channel_id" };
            }

            const { fallback, blocks } = buildClientBlocks(
              metrics as ClientMetrics,
              narrative,
              report.id,
              label
            );

            await postMessage({
              channel: customer.slack_channel_id,
              text: fallback,
              blocks: blocks as never,
            });

            await prisma.advantageReport.update({
              where: { id: report.id },
              data: { status: "sent" },
            });

            return { action: "sent" as const, channel: customer.slack_channel_id };

          } else if (report.report_type === "va_monthly") {
            // Resolve Va.slack_user_id from va_id in metrics_json
            const vaId = typeof metrics.va_id === "number"
              ? metrics.va_id
              : null;

            if (!vaId) {
              return { action: "skipped" as const, reason: "no_va_id_in_metrics" };
            }

            const va = await prisma.va.findUnique({
              where: { id: vaId },
              select: { slack_user_id: true, display_name: true },
            });

            if (!va?.slack_user_id) {
              return { action: "skipped" as const, reason: "no_slack_user_id" };
            }

            const { fallback, blocks } = buildVaBlocks(
              metrics as VaMetrics,
              narrative,
              report.id,
              label
            );

            await sendDM(va.slack_user_id, fallback, blocks as never);

            await prisma.advantageReport.update({
              where: { id: report.id },
              data: { status: "sent" },
            });

            return { action: "sent" as const, channel: va.slack_user_id };

          } else {
            return { action: "skipped" as const, reason: `unknown_type:${report.report_type}` };
          }
        } catch (err) {
          const msg = String(err).slice(0, 500);
          await prisma.advantageReport
            .update({
              where: { id: report.id },
              data: { status: "failed" },
            })
            .catch(() => undefined);
          return { action: "failed" as const, reason: msg };
        }
      });

      if (result.action === "sent") {
        sent++;
      } else if (result.action === "skipped") {
        skipped++;
        logger.warn(`advantage-report-sender: skipped ${report.id}: ${result.reason}`);
      } else {
        failed++;
        logger.error(`advantage-report-sender: failed ${report.id}: ${result.reason}`);
      }
    }

    logger.info(
      `advantage-report-sender: done. sent=${sent} skipped=${skipped} failed=${failed}`
    );
    return { sent, skipped, failed };
  }
);
