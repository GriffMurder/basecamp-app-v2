/**
 * inngest/functions/founder-alerts.ts
 *
 * Port of app/founder_alerts.py
 *
 * Daily: evaluate all active managers against 4 systemic trigger conditions
 * and DM the founder if any are met. Deduplicates within a 7-day window.
 *
 * Trigger conditions (ANY fires an alert):
 *   1. SLA breach count   ≥2 resolved manager interventions in last 14 days
 *                         where elapsed response time > tier SLA
 *   2. Open escalations   ≥3 open manager-level interventions
 *   3. Avg over-SLA pct   avg(elapsed / tier_sla) > 1.25 over 14 days
 *   4. At-risk clients    ≥3 clients with client_health_score < 70
 *
 * Config env vars:
 *   FOUNDER_DM_SLACK_USER_ID   – founder's Slack user ID to DM
 *   FOUNDER_ALERT_SLA_BREACH_MIN    (default 2)
 *   FOUNDER_ALERT_OPEN_ESC_MIN      (default 3)
 *   FOUNDER_ALERT_AVG_OVER_SLA      (default 1.25)
 *   FOUNDER_ALERT_AT_RISK_MIN       (default 3)
 *   FOUNDER_ALERT_AT_RISK_SCORE     (default 70)
 *   FOUNDER_ALERT_DEDUP_DAYS        (default 7)
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { sendDM } from "@/lib/slack";

const SLA_BREACH_MIN = parseInt(process.env.FOUNDER_ALERT_SLA_BREACH_MIN ?? "2");
const OPEN_ESC_MIN = parseInt(process.env.FOUNDER_ALERT_OPEN_ESC_MIN ?? "3");
const AVG_OVER_SLA = parseFloat(process.env.FOUNDER_ALERT_AVG_OVER_SLA ?? "1.25");
const AT_RISK_MIN = parseInt(process.env.FOUNDER_ALERT_AT_RISK_MIN ?? "3");
const AT_RISK_SCORE = parseInt(process.env.FOUNDER_ALERT_AT_RISK_SCORE ?? "70");
const DEDUP_DAYS = parseInt(process.env.FOUNDER_ALERT_DEDUP_DAYS ?? "7");

const TIER_SLA_HOURS: Record<string, number> = {
  A: 4,
  tier_a: 4,
  B: 8,
  tier_b: 8,
  C: 24,
  tier_c: 24,
};

function tierSlaHours(tier: string | null): number {
  if (!tier) return 8;
  return TIER_SLA_HOURS[tier] ?? 8;
}

export const founderAlerts = inngest.createFunction(
  {
    id: "founder-alerts",
    name: "Founder Alerts — Manager Pattern Detection",
    concurrency: { limit: 1 },
  },
  [
    { cron: "0 15 * * 1-5" }, // Mon–Fri 15:00 UTC (10:00 CT)
    { event: "tb/founder-alerts.requested" },
  ],
  async ({ step, logger }) => {
    const founderUserId = process.env.FOUNDER_DM_SLACK_USER_ID;
    if (!founderUserId) {
      logger.warn("founder-alerts: FOUNDER_DM_SLACK_USER_ID not set — skipping");
      return { skipped: true, reason: "no_founder_user_id" };
    }

    const now = new Date();
    const breach14 = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const dedupeWindow = new Date(now.getTime() - DEDUP_DAYS * 24 * 60 * 60 * 1000);

    // ── Step 1: load active managers ──────────────────────────────────────
    const managers = await step.run("load-active-managers", async () => {
      return prisma.manager.findMany({
        where: { active: true },
        select: { id: true, slack_user_id: true, display_name: true },
      });
    });

    if (!managers.length) {
      logger.info("founder-alerts: no active managers");
      return { skipped: true, reason: "no_managers" };
    }

    // ── Step 2: load existing open founder alerts (dedup) ─────────────────
    const existingAlerts = await step.run("load-existing-founder-alerts", async () => {
      const rows = await prisma.intervention.findMany({
        where: {
          level: "founder",
          status: "open",
          created_at: { gte: dedupeWindow },
        },
        select: { target_person_id: true },
      });
      return rows.map((r) => r.target_person_id).filter(Boolean) as string[];
    });

    // ── Step 3: load customer assignments per manager ─────────────────────
    const allAssignments = await step.run("load-customer-assignments", async () => {
      return prisma.customerAssignment.findMany({
        where: { active: true },
        select: { manager_id: true, customer_id: true },
      });
    });

    const assignmentsByManager = new Map<number, number[]>();
    for (const a of allAssignments) {
      const list = assignmentsByManager.get(a.manager_id) ?? [];
      list.push(a.customer_id);
      assignmentsByManager.set(a.manager_id, list);
    }

    // ── Step 4: evaluate each manager ────────────────────────────────────
    let alertsSent = 0;
    let errors = 0;

    for (const mgr of managers) {
      if (existingAlerts.includes(mgr.slack_user_id)) {
        logger.debug(`founder-alerts: skipping ${mgr.display_name} (existing alert)`);
        continue;
      }

      const customerIds = assignmentsByManager.get(mgr.id) ?? [];
      if (!customerIds.length) continue;

      const result = await step.run(`evaluate-manager-${mgr.id}`, async () => {
        const triggers: string[] = [];
        const triggerData: Record<string, unknown> = {};

        // ── T1: SLA breach count ────────────────────────────────────────
        const resolvedIvns = await prisma.intervention.findMany({
          where: {
            level: "manager",
            status: "resolved",
            customer_id: { in: customerIds },
            sent_at: { gte: breach14 },
            response_at: { not: null },
          },
          select: { id: true, customer_id: true, sent_at: true, response_at: true },
        });

        // Gather customer tiers
        const custTiers = await prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, effective_tier: true, client_health_score: true },
        });
        const tierMap = Object.fromEntries(custTiers.map((c) => [c.id, c.effective_tier]));
        const healthMap = Object.fromEntries(custTiers.map((c) => [c.id, c.client_health_score]));

        let breachCount = 0;
        const ratios: number[] = [];
        for (const ivn of resolvedIvns) {
          if (!ivn.sent_at || !ivn.response_at) continue;
          const sentAt = new Date(ivn.sent_at.toString());
          const respAt = new Date(ivn.response_at.toString());
          const elapsedH = (respAt.getTime() - sentAt.getTime()) / (1000 * 60 * 60);
          const slaH = ivn.customer_id ? tierSlaHours(tierMap[ivn.customer_id] ?? null) : 8;
          if (elapsedH > slaH) breachCount++;
          if (slaH > 0) ratios.push(elapsedH / slaH);
        }

        if (breachCount >= SLA_BREACH_MIN) {
          triggers.push("sla_breach_count");
          triggerData.breach_count = breachCount;
        }

        // ── T2: Open escalations ────────────────────────────────────────
        const openCount = await prisma.intervention.count({
          where: {
            level: "manager",
            status: "open",
            customer_id: { in: customerIds },
          },
        });
        if (openCount >= OPEN_ESC_MIN) {
          triggers.push("open_escalations");
          triggerData.open_count = openCount;
        }

        // ── T3: Avg over-SLA ratio ──────────────────────────────────────
        if (ratios.length > 0) {
          const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
          if (avgRatio > AVG_OVER_SLA) {
            triggers.push("avg_over_sla");
            triggerData.avg_ratio = Math.round(avgRatio * 100);
          }
        }

        // ── T4: At-risk clients ─────────────────────────────────────────
        const atRiskClients = custTiers.filter(
          (c) => c.client_health_score !== null && c.client_health_score < AT_RISK_SCORE
        );
        if (atRiskClients.length >= AT_RISK_MIN) {
          triggers.push("at_risk_clients");
          triggerData.at_risk_count = atRiskClients.length;
          triggerData.at_risk_health_scores = atRiskClients.map((c) => ({
            id: c.id,
            score: c.client_health_score,
          }));
        }

        if (!triggers.length) return { ok: true, triggered: false };

        // ── Fire alert ──────────────────────────────────────────────────
        const triggerLines = triggers.map((t) => {
          switch (t) {
            case "sla_breach_count":
              return `• *SLA breaches:* ${triggerData.breach_count} in last 14 days (threshold ${SLA_BREACH_MIN})`;
            case "open_escalations":
              return `• *Open escalations:* ${triggerData.open_count} currently open (threshold ${OPEN_ESC_MIN})`;
            case "avg_over_sla":
              return `• *Avg response time:* ${triggerData.avg_ratio}% of tier SLA (threshold ${AVG_OVER_SLA * 100}%)`;
            case "at_risk_clients":
              return `• *At-risk clients:* ${triggerData.at_risk_count} clients with health score < ${AT_RISK_SCORE} (threshold ${AT_RISK_MIN})`;
            default:
              return `• ${t}`;
          }
        });

        const alertText = [
          `⚠️ *Manager Pattern Alert: ${mgr.display_name}*`,
          ``,
          `The following patterns have been detected:`,
          ...triggerLines,
          ``,
          `_This alert will not repeat for ${DEDUP_DAYS} days unless resolved._`,
        ].join("\n");

        // Create founder-level intervention
        const intv = await prisma.intervention.create({
          data: {
            level: "founder",
            reason: `Manager pattern alert: ${triggers.join(", ")}`,
            target_person_id: mgr.slack_user_id,
            status: "open",
            sent_at: new Date(),
          },
          select: { id: true },
        });

        // DM the founder
        await sendDM(founderUserId, alertText);

        return {
          ok: true,
          triggered: true,
          manager: mgr.display_name,
          triggers,
          intervention_id: intv.id.toString(),
        };
      });

      if (!result.ok) {
        errors++;
      } else if (result.triggered && "manager" in result) {
        alertsSent++;
        logger.info(`founder-alerts: alert sent for manager ${result.manager}`, {
          triggers: result.triggers,
        });
      }
    }

    return {
      managers_evaluated: managers.length,
      alerts_sent: alertsSent,
      errors,
    };
  }
);
