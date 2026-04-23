/**
 * inngest/functions/escalation-reping.ts
 *
 * Port of app/escalation_reping.py
 *
 * Hourly (business hours): find open manager-level interventions that have been
 * sitting without a response, re-ping the manager in the Slack thread, and
 * auto-escalate to founder after 48 h.
 *
 * Config (env or defaults):
 *   ESCALATION_REPING_HOURS   – hours before first re-ping  (default 24)
 *   ESCALATION_FOUNDER_HOURS  – hours before founder escalation (default 48)
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { postMessage, sendDM } from "@/lib/slack";

const REPING_HOURS = parseInt(process.env.ESCALATION_REPING_HOURS ?? "24");
const FOUNDER_HOURS = parseInt(process.env.ESCALATION_FOUNDER_HOURS ?? "48");

export const escalationReping = inngest.createFunction(
  {
    id: "escalation-reping",
    name: "Escalation Re-ping",
    concurrency: { limit: 1 },
  },
  [
    { cron: "0 13-22 * * 1-5" }, // every hour 13:00–22:00 UTC (08:00–17:00 CT)
    { event: "tb/escalation-reping.requested" },
  ],
  async ({ step, logger }) => {
    const now = new Date();
    const repingCutoff = new Date(now.getTime() - REPING_HOURS * 60 * 60 * 1000);
    const founderCutoff = new Date(now.getTime() - FOUNDER_HOURS * 60 * 60 * 1000);

    // ── Step 1: load stale manager escalations ─────────────────────────────
    const stale = await step.run("load-stale-escalations", async () => {
      const rows = await prisma.intervention.findMany({
        where: {
          level: "manager",
          status: "open",
          sent_at: { not: null, lt: repingCutoff },
          slack_msg_ts: { not: null },
          slack_channel_id: { not: null },
        },
        select: {
          id: true,
          level: true,
          reason: true,
          target_person_id: true,
          customer_id: true,
          todo_id: true,
          status: true,
          sent_at: true,
          slack_msg_ts: true,
          slack_channel_id: true,
          parent_intervention_id: true,
        },
        orderBy: { sent_at: "asc" },
        take: 100,
      });

      return rows.map((r) => ({
        ...r,
        id: r.id.toString(),
        parent_intervention_id: r.parent_intervention_id?.toString() ?? null,
      }));
    });

    if (!stale.length) {
      logger.info("escalation-reping: no stale escalations found");
      return { stale_found: 0, repinged: 0, escalated_to_founder: 0 };
    }

    // ── Step 2: load customer names ────────────────────────────────────────
    const customerIds = stale
      .filter((s) => s.customer_id !== null)
      .map((s) => s.customer_id as number);

    const customers = await step.run("load-customer-names", async () => {
      if (!customerIds.length) return {};
      const rows = await prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, name: true },
      });
      return Object.fromEntries(rows.map((r) => [r.id, r.name]));
    });

    // ── Step 3: check for recent re-ping interactions (dedup) ─────────────
    const recentRepings = await step.run("load-recent-repings", async () => {
      const since = repingCutoff;
      const rows = await prisma.interaction.findMany({
        where: {
          interaction_type: "escalation_reping",
          happened_at: { gte: since },
        },
        select: { payload: true },
      });
      // collect array of intervention ids already re-pinged in this window
      const ids: string[] = [];
      for (const r of rows) {
        const p = r.payload as Record<string, unknown> | null;
        if (p?.intervention_id) ids.push(String(p.intervention_id));
      }
      return ids;
    });

    // ── Step 4: process each stale escalation ─────────────────────────────
    let repinged = 0;
    let escalatedToFounder = 0;
    let errors = 0;

    for (const intv of stale) {
      if (recentRepings.includes(intv.id)) continue;

      const custName =
        intv.customer_id && customers[intv.customer_id]
          ? customers[intv.customer_id]
          : "Unknown Client";

      const sentAt = intv.sent_at ? new Date(intv.sent_at.toString()) : now;
      const hoursOpen = (now.getTime() - sentAt.getTime()) / (1000 * 60 * 60);

      if (sentAt < founderCutoff) {
        // Escalate to founder
        const result = await step.run(`founder-escalate-${intv.id}`, async () => {
          try {
            // Mark original as escalated
            await prisma.intervention.update({
              where: { id: BigInt(intv.id) },
              data: { status: "escalated" },
            });

            // Create founder-level child intervention
            const founderIntv = await prisma.intervention.create({
              data: {
                level: "founder",
                reason: `Auto-escalated: manager escalation open ${hoursOpen.toFixed(0)}h (>${FOUNDER_HOURS}h)`,
                target_person_id: process.env.FOUNDER_DM_SLACK_USER_ID ?? null,
                customer_id: intv.customer_id,
                todo_id: intv.todo_id,
                status: "open",
                parent_intervention_id: BigInt(intv.id),
                sent_at: new Date(),
              },
              select: { id: true },
            });

            // Reply in original thread
            if (intv.slack_channel_id && intv.slack_msg_ts) {
              await postMessage({
                channel: intv.slack_channel_id,
                thread_ts: intv.slack_msg_ts,
                text: `🚨 *Auto-escalated to founder.* This escalation for *${custName}* has been unresolved for *${hoursOpen.toFixed(0)}h*.`,
              });
            }

            // DM founder
            const founderUserId = process.env.FOUNDER_DM_SLACK_USER_ID;
            if (founderUserId) {
              const alertText = [
                `🚨 *Stale Escalation — Auto-escalated*`,
                `*Client:* ${custName}`,
                `*Open for:* ${hoursOpen.toFixed(0)} hours`,
                `*Original reason:* ${intv.reason || "N/A"}`,
                `The manager has not responded to this escalation.`,
              ].join("\n");

              await sendDM(founderUserId, alertText);
            }

            // Log the escalation interaction
            await prisma.interaction.create({
              data: {
                source: "escalation_reping",
                customer_id: intv.customer_id ?? 0,
                todo_id: intv.todo_id,
                interaction_type: "escalation_reping",
                happened_at: new Date(),
                payload: {
                  intervention_id: intv.id,
                  action: "founder_escalation",
                  level: intv.level,
                  founder_intervention_id: founderIntv.id.toString(),
                },
              },
            });

            return { ok: true, action: "founder_escalation" };
          } catch (err) {
            logger.error("escalation-reping: founder escalation failed", { interventionId: intv.id, err });
            return { ok: false, error: String(err) };
          }
        });

        if (result.ok) escalatedToFounder++;
        else errors++;
      } else {
        // Re-ping manager
        const result = await step.run(`reping-${intv.id}`, async () => {
          try {
            if (!intv.slack_channel_id || !intv.slack_msg_ts) {
              return { ok: false, error: "no_slack_ref" };
            }

            await postMessage({
              channel: intv.slack_channel_id,
              thread_ts: intv.slack_msg_ts,
              text: `⏰ *Reminder:* This escalation for *${custName}* has been open for *${hoursOpen.toFixed(0)}h*. If resolved, please use the resolve button above. Otherwise, please respond.`,
            });

            // Log dedup interaction
            await prisma.interaction.create({
              data: {
                source: "escalation_reping",
                customer_id: intv.customer_id ?? 0,
                todo_id: intv.todo_id,
                interaction_type: "escalation_reping",
                happened_at: new Date(),
                payload: {
                  intervention_id: intv.id,
                  action: "reping",
                  level: intv.level,
                },
              },
            });

            return { ok: true, action: "reping" };
          } catch (err) {
            logger.error("escalation-reping: reping failed", { interventionId: intv.id, err });
            return { ok: false, error: String(err) };
          }
        });

        if (result.ok) repinged++;
        else errors++;
      }
    }

    return {
      stale_found: stale.length,
      repinged,
      escalated_to_founder: escalatedToFounder,
      errors,
    };
  }
);
