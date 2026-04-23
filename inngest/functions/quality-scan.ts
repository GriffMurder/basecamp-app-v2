/**
 * inngest/functions/quality-scan.ts
 *
 * Port of app/quality_signals.py
 *
 * Scans BasecampThreadActivity for client-authored comments containing
 * quality signal keywords (REVISION_REQUESTED, NEGATIVE_FEEDBACK, PRAISE_SIGNAL)
 * and creates TaskQualityEvent rows (idempotent via dedupe_key).
 *
 * Also performs stall detection:
 *   TaskCompletionReport with status=posted and posted_at <= now-STALL_HOURS
 *   where BTA shows no client activity after posted_at →
 *   CLIENT_NO_RESPONSE_AFTER_DELIVERY event.
 *
 * Keyword lists ported from Python:
 *   REVISION_REQUESTED_KEYWORDS
 *   NEGATIVE_FEEDBACK_KEYWORDS
 *   PRAISE_SIGNAL_KEYWORDS
 *
 * Data source:
 *   BasecampThreadActivity.last_customer_text — avoids Basecamp API rate limits
 *
 * Cron: every 4 hours
 * Also fires on: tb/quality-scan.requested
 *
 * Env:
 *   STALL_NO_RESPONSE_HOURS — hours before stall is flagged (default 48)
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";

// ── Keyword lists ──────────────────────────────────────────────────────────────

const REVISION_REQUESTED_KEYWORDS = [
  "revision", "revise", "re-do", "redo", "do over", "try again",
  "needs more work", "rework", "rewrite", "revamp", "rebuild", "rescope",
  "rescoped", "start over", "from scratch", "back to square one",
  "completely different", "throw it out", "scrap it", "doesn't work",
  "won't work", "can't use this", "not usable", "unusable", "resubmit",
  "redo this", "redo the", "re-submit",
];

const NEGATIVE_FEEDBACK_KEYWORDS = [
  "disappointed", "unsatisfied", "unhappy", "frustrated", "frustration",
  "frustrating", "waste of time", "wasted time", "wasting time", "terrible",
  "horrible", "awful", "garbage", "trash", "useless", "worthless", "bad",
  "very bad", "really bad", "worse", "worst", "not good", "no good",
  "lacking", "missing", "incomplete", "not complete", "insufficient",
  "not enough", "poor quality", "low quality", "subpar", "below expectations",
  "below standard", "unacceptable", "not acceptable", "disappointing",
  "let down", "letdown", "bad experience",
  "doesn't function", "buggy", "failure", "failed", "crash", "crashed",
];

const PRAISE_SIGNAL_KEYWORDS = [
  "great", "wonderful", "excellent", "amazing", "awesome", "fantastic",
  "perfect", "love it", "love this", "really appreciate", "appreciate",
  "grateful", "thank you", "thanks", "thx", "impressed", "delighted",
  "pleased", "happy", "very happy", "so happy", "excited", "thrilled",
  "incredible", "awesome job", "great job", "well done", "nice work",
  "exactly what i", "exactly what we", "just what i", "just what we",
  "just right", "perfect job", "superb", "kudos", "solid", "top notch",
  "top-notch", "on point", "helpful", "very helpful", "so helpful",
  "clear", "very clear", "makes sense", "now i understand",
];

// ── Signal detection helpers ───────────────────────────────────────────────────

function findKeywords(text: string | null, keywords: string[]): string[] {
  if (!text?.trim()) return [];
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) found.add(kw.toLowerCase());
  }
  return [...found];
}

function detectSignals(text: string | null): Record<string, { keywords: string[]; snippet: string }> {
  const result: Record<string, { keywords: string[]; snippet: string }> = {};
  if (!text?.trim()) return result;
  const snippet = text.trim().slice(0, 800);

  for (const [eventType, wordList] of [
    ["REVISION_REQUESTED", REVISION_REQUESTED_KEYWORDS],
    ["NEGATIVE_FEEDBACK",  NEGATIVE_FEEDBACK_KEYWORDS],
    ["PRAISE_SIGNAL",      PRAISE_SIGNAL_KEYWORDS],
  ] as [string, string[]][]) {
    const matched = findKeywords(text, wordList);
    if (matched.length > 0) {
      result[eventType] = { keywords: matched, snippet };
    }
  }
  return result;
}

/** Chicago timezone day key (YYYY-MM-DD). Matches Python's chicago_day_key(). */
function chicagoDayKey(dt: Date): string {
  // America/Chicago: UTC-6 (CST) or UTC-5 (CDT) roughly Mar-Nov
  const month = dt.getUTCMonth() + 1;
  const isDST = month >= 3 && month <= 11;
  const offset = isDST ? -5 : -6;
  const local = new Date(dt.getTime() + offset * 3_600_000);
  return local.toISOString().slice(0, 10);
}

/** dedupe_key: {thread_id}:{event_type}:{chicago_day} */
function dedupeKey(threadId: string, eventType: string, dt: Date): string {
  return `${threadId}:${eventType}:${chicagoDayKey(dt)}`;
}

// ── Inngest function ───────────────────────────────────────────────────────────

const STALL_HOURS = parseInt(process.env.STALL_NO_RESPONSE_HOURS ?? "48");

export const qualityScan = inngest.createFunction(
  {
    id: "quality-scan",
    name: "Quality Signal Scanner",
    concurrency: { limit: 1 },
  },
  [
    { cron: "0 */4 * * *" }, // Every 4 hours
    { event: "tb/quality-scan.requested" },
  ],
  async ({ step, logger }) => {
    const now = new Date();
    const lookbackMs = 4 * 60 * 60 * 1000; // 4 hours
    const since = new Date(now.getTime() - lookbackMs);

    // ── Step 1: scan BTA client comments for quality keywords ─────────────
    const signalStats = await step.run("scan-comment-signals", async () => {
      const internalIds = (process.env.BASECAMP_INTERNAL_PERSON_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      // BTA rows with recent client activity
      const rows = await prisma.basecampThreadActivity.findMany({
        where: {
          last_customer_at: { gte: since },
          last_customer_text: { not: null },
          resolved_at: null,
        },
        select: {
          id: true,
          basecamp_todo_id: true,
          last_customer_text: true,
          last_customer_author: true,
          last_customer_at: true,
        },
      });

      let written = 0;
      let deduped = 0;
      let errors = 0;

      for (const row of rows) {
        if (!row.basecamp_todo_id || !row.last_customer_at) continue;
        const threadId = row.basecamp_todo_id;
        const commentAt = new Date(row.last_customer_at.toString());
        const syntheticCommentId = `bta:${row.id}:${chicagoDayKey(commentAt)}`;

        const signals = detectSignals(row.last_customer_text);
        for (const [eventType, { keywords, snippet }] of Object.entries(signals)) {
          const dk = dedupeKey(threadId, eventType, commentAt);
          try {
            await prisma.taskQualityEvent.upsert({
              where: { dedupe_key: dk },
              update: {},
              create: {
                basecamp_thread_id:  threadId,
                basecamp_comment_id: syntheticCommentId,
                comment_author:      row.last_customer_author ?? null,
                event_type:          eventType,
                matched_keywords:    keywords,
                snippet:             snippet,
                dedupe_key:          dk,
              },
            });
            written++;
          } catch (err: unknown) {
            if (String(err).includes("Unique constraint")) {
              deduped++;
            } else {
              logger.warn(`quality-scan: error writing event ${dk}: ${err}`);
              errors++;
            }
          }
        }
      }

      return { btaScanned: rows.length, written, deduped, errors };
    });

    // ── Step 2: stall detection — CLIENT_NO_RESPONSE_AFTER_DELIVERY ───────
    const stallStats = await step.run("scan-stalls", async () => {
      const stallCutoff = new Date(now.getTime() - STALL_HOURS * 3_600_000);
      const EVENT_TYPE = "CLIENT_NO_RESPONSE_AFTER_DELIVERY";

      const reports = await prisma.taskCompletionReport.findMany({
        where: {
          status: "posted",
          posted_at: { lte: stallCutoff },
        },
        select: {
          id: true,
          basecamp_thread_id: true,
          posted_at: true,
        },
        take: 200,
      });

      let written = 0;
      let hasResponse = 0;
      let deduped = 0;
      let errors = 0;

      for (const report of reports) {
        if (!report.posted_at || !report.basecamp_thread_id) continue;
        const postedAt = new Date(report.posted_at.toString());
        const threadId = report.basecamp_thread_id;

        // Check BTA for client response after posted_at
        const bta = await prisma.basecampThreadActivity.findFirst({
          where: { basecamp_todo_id: threadId },
          select: { last_customer_at: true },
        });

        const lastCustomerAt = bta?.last_customer_at
          ? new Date(bta.last_customer_at.toString())
          : null;

        if (lastCustomerAt && lastCustomerAt > postedAt) {
          hasResponse++;
          continue; // Client responded — not a stall
        }

        const dk = dedupeKey(threadId, EVENT_TYPE, postedAt);
        const syntheticCommentId = `stall:${report.id}`;

        try {
          await prisma.taskQualityEvent.upsert({
            where: { dedupe_key: dk },
            update: {},
            create: {
              basecamp_thread_id:  threadId,
              basecamp_comment_id: syntheticCommentId,
              comment_author:      null,
              event_type:          EVENT_TYPE,
              matched_keywords:    ["stall_detected"],
              snippet:             `No client response within ${STALL_HOURS}h of report posted`,
              dedupe_key:          dk,
            },
          });
          written++;
        } catch (err: unknown) {
          if (String(err).includes("Unique constraint")) {
            deduped++;
          } else {
            logger.warn(`quality-scan stall: error for ${threadId}: ${err}`);
            errors++;
          }
        }
      }

      return { reportsScanned: reports.length, written, hasResponse, deduped, errors };
    });

    logger.info(
      `quality-scan done: signals=${JSON.stringify(signalStats)} stalls=${JSON.stringify(stallStats)}`
    );

    return { signals: signalStats, stalls: stallStats };
  }
);
