/**
 * VA Daily Post — weekday broadcast to OPEN_TASKS_CHANNEL_ID
 *
 * Fires Mon–Fri at 13:00 UTC (08:00 CT / CST) via cron, and on-demand via
 * event `va/daily-post.requested`.
 *
 * Hard guardrails (safe-by-construction):
 *   • No client names, no todo titles, no Basecamp URLs
 *   • No VA name connected to a performance issue
 *   • Aggregate stats only in §4
 *
 * Sections:
 *   §1  Today's Focus      — rotating 7-day tip cycle (keyed by weekday)
 *   §2  What Counts        — meaningful-update reminder (static)
 *   §3  AI Nudge Protocol  — response protocol (static)
 *   §4  Yesterday's Pulse  — aggregate DB stats (gracefully absent if empty)
 */
import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { WebClient } from "@slack/web-api";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

// ── §1 Daily rotating tips (7-item cycle) ────────────────────────────────────
const DAILY_TIPS: Record<number, { headline: string; body: string }> = {
  1: {
    headline: "🗓️  *Tip: Plan for the week, not just the day.*",
    body: "Before diving in, scan all your open tasks and flag anything due this week. Set a realistic completion order. A 2-minute scan now prevents a last-minute scramble on Friday.",
  },
  2: {
    headline: "🔄  *Tip: Update cadence expectations.*",
    body: "Clients expect to hear from us at least every 48 business hours on active tasks. If you haven't posted a Basecamp update on a task in 2 days, post one today — even a single line: *what's done, what's next, any blockers.*",
  },
  3: {
    headline: "📋  *Tip: What counts as a meaningful update.*",
    body: "A meaningful update answers three things:\n1. *What progress was made?*\n2. *What is the next action?*\n3. *Is anything blocked?*\n\nAvoid vague replies like \"working on it\" — be specific enough that a manager can read the update without asking follow-up questions.",
  },
  4: {
    headline: "🚧  *Tip: Blockers belong in Basecamp, not your head.*",
    body: "If something is stopping you — access issues, unclear instructions, waiting on a third party — log it in Basecamp *today*. Unlogged blockers look like inactivity and can trigger escalations. Flag it early so the team can help.",
  },
  5: {
    headline: "📅  *Tip: Own your due dates.*",
    body: "Before end of day, review every task due next week. If a date needs to shift, update it in Basecamp *before* it becomes overdue — not after. Proactive adjustments are professional; missed due dates without notice are not.",
  },
  6: {
    headline: "🎯  *Tip: Quality over quantity.*",
    body: "One task fully closed and properly documented is worth more than three tasks half-done. Before marking a task complete, confirm the deliverable is ready and post a brief completion note in Basecamp.",
  },
  0: {
    headline: "💡  *Tip: Communication is the job.*",
    body: "Technical skill gets the work done; communication keeps the client confident. Every Basecamp update you post is the signal that the task is alive. No update = silent = escalation-eligible.",
  },
};

// ── §2 Meaningful-update reminder (static) ───────────────────────────────────
const MEANINGFUL_UPDATE_TEXT =
  "*What counts as a meaningful update?*\n\n" +
  "✅  Describes actual progress or a clear next step\n" +
  "✅  Names any blocker clearly (what it is, who can unblock it)\n" +
  "✅  Adjusts the due date proactively if the timeline has shifted\n\n" +
  "❌  Does *not* count: vague \"in progress\", reading an email, or no update at all\n\n" +
  "_Rule of thumb: if a manager asked \"what's the status?\", your update should answer it without a follow-up question._";

// ── §3 AI nudge response protocol (static) ───────────────────────────────────
const AI_NUDGE_TEXT =
  "*How to respond to AI nudges:*\n\n" +
  "When AI Wesley sends you a check-in DM, tap the button that best describes the situation:\n\n" +
  "• ✅  *Done* — task is complete but not yet marked so in Basecamp → close it now\n" +
  "• 🚧  *Blocked* — post the details in Basecamp immediately *(escalates to your manager)*\n" +
  "• 📅  *Due Date Change* — update the date in Basecamp *(escalates to your manager)*\n" +
  "• ⏳  *Awaiting Client* — leave a note confirming you're waiting\n\n" +
  "_Respond within 4 business hours. Unresponded nudges automatically escalate._";

// ── §4 Yesterday's Pulse (aggregate stats, no names) ─────────────────────────
async function fetchYesterdayStats() {
  const now = new Date();
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayStart = new Date(dayEnd.getTime() - 24 * 60 * 60 * 1000);

  try {
    const [totalResolved, inSla, nudgesSent, nudgesResponded, openTodos, staleTodos] =
      await Promise.all([
        prisma.intervention.count({
          where: {
            level: "manager",
            status: "resolved",
            resolved_at: { gte: dayStart, lt: dayEnd },
          },
        }),
        prisma.intervention.count({
          where: {
            level: "manager",
            status: "resolved",
            resolved_at: { gte: dayStart, lt: dayEnd },
            OR: [{ sla_due_at: null }, { sla_breached_at: null }],
          },
        }),
        prisma.intervention.count({
          where: { level: "va", created_at: { gte: dayStart, lt: dayEnd } },
        }),
        prisma.intervention.count({
          where: {
            level: "va",
            status: "resolved",
            created_at: { gte: dayStart, lt: dayEnd },
          },
        }),
        prisma.basecampTodo.count({ where: { completed: false } }),
        prisma.basecampTodo.count({
          where: {
            completed: false,
            updated_at: { lt: new Date(now.getTime() - 48 * 60 * 60 * 1000) },
          },
        }),
      ]);

    return {
      totalResolved,
      inSla,
      slaPct: totalResolved > 0 ? Math.round((inSla / totalResolved) * 100) : null,
      nudgesSent,
      nudgesResponded,
      responsePct:
        nudgesSent > 0 ? Math.round((nudgesResponded / nudgesSent) * 100) : null,
      openTodos,
      staleTodos,
    };
  } catch {
    return null;
  }
}

// ── Main function ─────────────────────────────────────────────────────────────
export const vaDailyPost = inngest.createFunction(
  {
    id: "va-daily-post",
    name: "VA Daily Post: Open Tasks Channel Broadcast",
    concurrency: { limit: 1 },
  },
  [{ cron: "0 13 * * 1-5" }, { event: "va/daily-post.requested" }],
  async ({ step }) => {
    const channelId = process.env.OPEN_TASKS_CHANNEL_ID;
    if (!channelId) {
      return { skipped: true, reason: "OPEN_TASKS_CHANNEL_ID not set" };
    }

    const now = new Date();
    const weekday = now.getDay(); // 0=Sun…6=Sat
    const tip = DAILY_TIPS[weekday] ?? DAILY_TIPS[1];

    const stats = await step.run("fetch-yesterday-stats", fetchYesterdayStats);

    await step.run("post-to-slack", async () => {
      const blocks: object[] = [
        {
          type: "header",
          text: { type: "plain_text", text: "📬  Good morning, TaskBullet team!", emoji: true },
        },
        // §1 Today's Focus
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*§1 — Today's Focus*\n\n${tip.headline}\n\n${tip.body}`,
          },
        },
        { type: "divider" },
        // §2 What Counts
        {
          type: "section",
          text: { type: "mrkdwn", text: `*§2 — Standards Reminder*\n\n${MEANINGFUL_UPDATE_TEXT}` },
        },
        { type: "divider" },
        // §3 AI Nudge Protocol
        {
          type: "section",
          text: { type: "mrkdwn", text: `*§3 — AI Nudge Protocol*\n\n${AI_NUDGE_TEXT}` },
        },
      ];

      // §4 Yesterday's Pulse — only shown if we have data
      if (stats) {
        const pulseLines: string[] = [];
        if (stats.nudgesSent > 0) {
          pulseLines.push(
            `• AI nudges sent: *${stats.nudgesSent}* — response rate: *${stats.responsePct ?? "—"}%*`
          );
        }
        if (stats.totalResolved > 0) {
          pulseLines.push(
            `• Manager escalations resolved: *${stats.totalResolved}* — in-SLA: *${stats.slaPct ?? "—"}%*`
          );
        }
        pulseLines.push(`• Open tasks right now: *${stats.openTodos}*`);
        if (stats.staleTodos > 0) {
          pulseLines.push(
            `• Tasks silent 48h+: *${stats.staleTodos}* — update any that are yours today`
          );
        }

        if (pulseLines.length > 0) {
          blocks.push({ type: "divider" });
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*§4 — Yesterday's Pulse*\n\n${pulseLines.join("\n")}`,
            },
          });
        }
      }

      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `_AI Wesley · ${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}_`,
          },
        ],
      });

      await slack.chat.postMessage({
        channel: channelId,
        text: "📬 Good morning! Daily ops briefing for TaskBullet team.",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        blocks: blocks as any,
      });
    });

    return { ok: true, weekday, channel: channelId };
  }
);
