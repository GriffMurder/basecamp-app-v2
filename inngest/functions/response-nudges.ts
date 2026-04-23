/**
 * inngest/functions/response-nudges.ts
 *
 * Port of app/response_nudges.py + the scanning/dispatch layer.
 *
 * Every 10 minutes on weekdays: scan BasecampThreadActivity for customer
 * comments that haven't received a TB reply. Dispatch timed nudges:
 *
 *   ~15m  → DM the assigned VA           (alerted_at_15m)
 *   ~60m  → DM the primary account mgr  (dm_am_sent_at_60m)
 *   ~90m  → Post to #ops channel        (ops_posted_at_90m)
 *
 * Each stage is idempotent: the timestamp column on the BTA row acts as the
 * dedup key. A stage only fires if the timestamp is null OR predates the
 * current customer comment.
 *
 * Cron: every 10 minutes Mon–Fri
 * Also fires on: tb/response-nudges.requested
 *
 * Env:
 *   RESPONSE_NUDGE_MIN_HOURS  – minimum age of unanswered comment to nudge (default 0.25 → 15m)
 *   RESPONSE_NUDGE_MAX_HOURS  – max age to consider (default 4 hours; older = stale)
 *   RESPONSE_NUDGE_60M_HOURS  – threshold for manager DM stage (default 1.0)
 *   RESPONSE_NUDGE_90M_HOURS  – threshold for ops post stage (default 1.5)
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { sendDM, postToOps } from "@/lib/slack";

const MIN_HOURS  = parseFloat(process.env.RESPONSE_NUDGE_MIN_HOURS  ?? "0.25");
const MAX_HOURS  = parseFloat(process.env.RESPONSE_NUDGE_MAX_HOURS  ?? "4");
const AM_HOURS   = parseFloat(process.env.RESPONSE_NUDGE_60M_HOURS  ?? "1.0");
const OPS_HOURS  = parseFloat(process.env.RESPONSE_NUDGE_90M_HOURS  ?? "1.5");

/** True if the tracker timestamp pre-dates the customer comment (no dedup) */
function needsSend(trackerAt: Date | string | null, lastCustomerAt: Date): boolean {
  if (!trackerAt) return true;
  const t = trackerAt instanceof Date ? trackerAt : new Date(trackerAt.toString());
  return t < lastCustomerAt;
}

export const responseNudges = inngest.createFunction(
  {
    id: "response-nudges",
    name: "Response Nudges",
    concurrency: { limit: 1 },
  },
  [
    { cron: "*/10 * * * 1-5" },
    { event: "tb/response-nudges.requested" },
  ],
  async ({ step, logger }) => {
    const now = new Date();
    const minAgo = new Date(now.getTime() - MIN_HOURS * 3_600_000);
    const maxAgo = new Date(now.getTime() - MAX_HOURS * 3_600_000);

    // ── Step 1: load pending threads ────────────────────────────────────────
    const threads = await step.run("load-pending-threads", async () => {
      return prisma.basecampThreadActivity.findMany({
        where: {
          last_customer_at: {
            gte: maxAgo,       // not too old
            lte: minAgo,       // old enough for the minimum wait
          },
          resolved_at: null,
          pending_human_followup: true,
          // Customer comment is newer than the last TB reply (or no TB reply)
          OR: [
            { last_tb_reply_at: null },
            { last_tb_reply_at: { lt: prisma.basecampThreadActivity.fields.last_customer_at } as never },
          ],
        },
        select: {
          id: true,
          basecamp_project_id: true,
          basecamp_todo_id: true,
          thread_url: true,
          assigned_va_id: true,
          last_customer_at: true,
          last_customer_text: true,
          last_tb_reply_at: true,
          alerted_at_15m: true,
          dm_am_sent_at_60m: true,
          ops_posted_at_90m: true,
        },
        take: 100,
      });
    });

    if (!threads.length) {
      logger.info("response-nudges: no pending threads");
      return { threads: 0, va_dms: 0, am_dms: 0, ops_posts: 0 };
    }

    let vaDms = 0;
    let amDms = 0;
    let opsPosts = 0;
    let errors = 0;

    // ── Step 2: process each thread ─────────────────────────────────────────
    for (const thread of threads) {
      const result = await step.run(`nudge-thread-${thread.id}`, async () => {
        try {
          const customerAt = new Date(thread.last_customer_at!.toString());
          const ageMs = now.getTime() - customerAt.getTime();
          const ageHours = ageMs / 3_600_000;

          const snippet = (thread.last_customer_text ?? "").slice(0, 120);
          const link = thread.thread_url ?? "";
          const todoId = thread.basecamp_todo_id ?? "";

          let sent = { va: false, am: false, ops: false };

          // Stage 1: ~15m → DM VA
          if (ageHours >= MIN_HOURS && needsSend(thread.alerted_at_15m, customerAt)) {
            const va = thread.assigned_va_id
              ? await prisma.person.findFirst({
                  where: { basecamp_person_id: thread.assigned_va_id, role: "va", active: true },
                  select: { slack_user_id: true, display_name: true },
                })
              : null;

            if (va?.slack_user_id) {
              const msg = [
                `📬 *Customer response waiting* — thread needs a reply`,
                snippet ? `> _"${snippet}"_` : null,
                link ? `<${link}|View thread>` : (todoId ? `Todo: ${todoId}` : null),
              ]
                .filter(Boolean)
                .join("\n");

              await sendDM(va.slack_user_id, msg);
              await prisma.basecampThreadActivity.update({
                where: { id: thread.id },
                data: { alerted_at_15m: now },
              });
              sent.va = true;
            }
          }

          // Stage 2: ~60m → DM account manager
          if (ageHours >= AM_HOURS && needsSend(thread.dm_am_sent_at_60m, customerAt)) {
            const manager = await resolveManager(thread.basecamp_project_id);
            if (manager) {
              const msg = [
                `⏰ *Customer reply still pending (${Math.round(ageHours * 60)}m)* — VA has not responded`,
                snippet ? `> _"${snippet}"_` : null,
                link ? `<${link}|View thread>` : null,
              ]
                .filter(Boolean)
                .join("\n");

              await sendDM(manager, msg);
              await prisma.basecampThreadActivity.update({
                where: { id: thread.id },
                data: { dm_am_sent_at_60m: now },
              });
              sent.am = true;
            }
          }

          // Stage 3: ~90m → post to ops channel
          if (ageHours >= OPS_HOURS && needsSend(thread.ops_posted_at_90m, customerAt)) {
            const msg = [
              `🚨 *Unanswered customer message (${Math.round(ageHours * 60)}m old)*`,
              snippet ? `> _"${snippet}"_` : null,
              link ? `<${link}|View thread>` : null,
            ]
              .filter(Boolean)
              .join("\n");

            await postToOps(msg);
            await prisma.basecampThreadActivity.update({
              where: { id: thread.id },
              data: { ops_posted_at_90m: now },
            });
            sent.ops = true;
          }

          return sent;
        } catch (err) {
          return { va: false, am: false, ops: false, error: String(err) };
        }
      });

      if ((result as { error?: string }).error) {
        errors++;
        logger.error(`response-nudges: error on thread ${thread.id}: ${(result as { error: string }).error}`);
      } else {
        if (result.va) vaDms++;
        if (result.am) amDms++;
        if (result.ops) opsPosts++;
      }
    }

    logger.info(
      `response-nudges: threads=${threads.length} va_dms=${vaDms} am_dms=${amDms} ops_posts=${opsPosts} errors=${errors}`
    );
    return { threads: threads.length, va_dms: vaDms, am_dms: amDms, ops_posts: opsPosts, errors };
  }
);

/** Look up the primary account manager's Slack user ID for a Basecamp project. */
async function resolveManager(basecampProjectId: string): Promise<string | null> {
  const customer = await prisma.customer.findFirst({
    where: { basecamp_project_id: basecampProjectId },
    select: { id: true },
  });
  if (!customer) return null;

  const assignment = await prisma.customerAssignment.findFirst({
    where: {
      customer_id: customer.id,
      is_primary: true,
      active: true,
    },
    select: { manager_id: true },
  });
  if (!assignment) return null;

  const manager = await prisma.manager.findFirst({
    where: { id: assignment.manager_id },
    select: { slack_user_id: true },
  });

  return manager?.slack_user_id ?? null;
}
