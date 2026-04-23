/**
 * inngest/functions/va-personalized-nudges.ts
 *
 * Port of app/va_personalized_nudges.py
 *
 * Weekday mornings: DM each active VA a personalized summary of their at-risk
 * threads — threads that need a TB reply and have been waiting 4+ hours.
 *
 * Cron: 13:30 UTC Mon–Fri (08:30 CT)
 * Also fires on: tb/va-personalized-nudges.requested
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { sendDM } from "@/lib/slack";

const MAX_THREADS = parseInt(process.env.VA_NUDGE_MAX_THREADS ?? "5");
const STALE_HOURS = parseInt(process.env.VA_NUDGE_STALE_HOURS ?? "4");

export const vaPersonalizedNudges = inngest.createFunction(
  {
    id: "va-personalized-nudges",
    name: "VA Personalized Nudges",
    concurrency: { limit: 1 },
  },
  [
    { cron: "30 13 * * 1-5" },
    { event: "tb/va-personalized-nudges.requested" },
  ],
  async ({ step, logger }) => {
    // ── Step 1: load active VAs ────────────────────────────────────────────
    const activeVas = await step.run("load-active-vas", async () => {
      return prisma.person.findMany({
        where: { role: "va", active: true, slack_user_id: { not: null } },
        select: {
          id: true,
          basecamp_person_id: true,
          slack_user_id: true,
          display_name: true,
        },
      });
    });

    if (!activeVas.length) {
      logger.info("va-personalized-nudges: no active VAs");
      return { skipped: true, reason: "no_active_vas" };
    }

    // Build a map from basecamp_person_id → VA for quick lookup
    const vaByBcId = new Map(
      activeVas
        .filter((v) => v.basecamp_person_id)
        .map((v) => [v.basecamp_person_id!, v])
    );

    // ── Step 2: load at-risk threads ──────────────────────────────────────
    const cutoff = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);

    const threads = await step.run("load-at-risk-threads", async () => {
      const rows = await prisma.basecampThreadActivity.findMany({
        where: {
          assigned_va_id: { not: null },
          last_customer_at: { lt: cutoff, not: null },
          resolved_at: null,
        },
        select: {
          id: true,
          basecamp_todo_id: true,
          basecamp_project_id: true,
          assigned_va_id: true,
          last_customer_at: true,
          last_tb_reply_at: true,
          last_customer_text: true,
          pending_human_followup: true,
        },
        orderBy: { last_customer_at: "asc" },
        take: 500,
      });

      // Filter: TB has not replied since the last customer message
      return rows.filter((r) => {
        if (!r.last_customer_at) return false;
        if (!r.last_tb_reply_at) return true; // never replied
        return r.last_tb_reply_at < r.last_customer_at;
      });
    });

    if (!threads.length) {
      logger.info("va-personalized-nudges: no at-risk threads found");
      return { sent: 0, skipped_reason: "no_at_risk_threads" };
    }

    // ── Step 3: load customer names for these projects ────────────────────
    const projectIds = [...new Set(threads.map((t) => t.basecamp_project_id))];
    const customerMap = await step.run("load-customer-names", async () => {
      const customers = await prisma.customer.findMany({
        where: { basecamp_project_id: { in: projectIds } },
        select: { basecamp_project_id: true, name: true },
      });
      return Object.fromEntries(
        customers
          .filter((c) => c.basecamp_project_id)
          .map((c) => [c.basecamp_project_id!, c.name])
      );
    });

    // ── Step 4: group threads by VA ───────────────────────────────────────
    const threadsByVa = new Map<string, typeof threads>();
    const now = new Date();

    for (const thread of threads) {
      const va = vaByBcId.get(thread.assigned_va_id!);
      if (!va?.slack_user_id) continue;

      const vaThreads = threadsByVa.get(va.slack_user_id) ?? [];
      vaThreads.push(thread);
      threadsByVa.set(va.slack_user_id, vaThreads);
    }

    // ── Step 5: send DMs ──────────────────────────────────────────────────
    let sent = 0;
    let errors = 0;

    for (const [slackUserId, vaThreads] of threadsByVa) {
      const va = activeVas.find((v) => v.slack_user_id === slackUserId);
      const displayName = va?.display_name ?? "there";

      // Cap threads per nudge
      const topThreads = vaThreads.slice(0, MAX_THREADS);

      const blocks: object[] = [
        {
          type: "header",
          text: { type: "plain_text", text: "🔔 Threads Needing Your Attention", emoji: true },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Hey ${displayName}! You have *${vaThreads.length} thread${vaThreads.length !== 1 ? "s" : ""}* waiting for a reply${vaThreads.length > MAX_THREADS ? ` (showing top ${MAX_THREADS})` : ""}.`,
          },
        },
        { type: "divider" },
      ];

      for (const thread of topThreads) {
        const lastCustomerAt = thread.last_customer_at ? new Date(thread.last_customer_at.toString()) : null;
        const waitMs = now.getTime() - (lastCustomerAt?.getTime() ?? 0);
        const waitHours = (waitMs / (1000 * 60 * 60)).toFixed(1);
        const customerName =
          (thread.basecamp_project_id && customerMap[thread.basecamp_project_id]) ||
          "Unknown Client";
        const snippet = thread.last_customer_text
          ? thread.last_customer_text.slice(0, 120)
          : "(no preview)";
        const todoId = thread.basecamp_todo_id ?? thread.id.toString();

        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${customerName}*\n_Waiting ${waitHours}h_ • Todo: \`${todoId}\`\n> ${snippet}${snippet.length === 120 ? "…" : ""}`,
          },
        });
      }

      if (vaThreads.length > MAX_THREADS) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `_…and ${vaThreads.length - MAX_THREADS} more. Check the ops dashboard for the full list._`,
          },
        });
      }

      blocks.push({ type: "divider" });
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Reply to each thread to clear it from your queue. Threads are considered resolved once TB replies after the last client message.",
          },
        ],
      });

      await step.run(`send-dm-${slackUserId}`, async () => {
        const fallback = `You have ${vaThreads.length} thread(s) waiting for a reply.`;
        try {
          await sendDM(
            slackUserId,
            fallback,
            blocks as Parameters<typeof sendDM>[2]
          );
          return { ok: true };
        } catch (err) {
          logger.error("va-personalized-nudges: DM failed", { slackUserId, err });
          return { ok: false, error: String(err) };
        }
      }).then((r) => {
        if (r.ok) sent++;
        else errors++;
      });
    }

    return { sent, errors, va_count: threadsByVa.size, threads_found: threads.length };
  }
);
