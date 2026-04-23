/**
 * lib/sentiment.ts
 * ~~~~~~~~~~~~~~~~
 * Port of app/sentiment.py — AI-powered sentiment analysis for customer comments.
 *
 * analyseSentiment()           → score a single comment → SentimentResult
 * getClientSentimentTrend()    → 7-day rolling stats for a customer
 * checkSentimentDipAlerts()    → scan all active clients for dips
 */

import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { prisma } from "@/lib/prisma";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SentimentResult {
  label: "positive" | "neutral" | "negative";
  score: number;       // -1.0 to +1.0
  key_quote: string;   // verbatim short phrase
}

export interface SentimentTrend {
  avg_score: number | null;
  comment_count: number;
  negative_count: number;
  positive_count: number;
  latest_key_quote: string | null;
  trend: "improving" | "stable" | "declining" | null;
}

export interface SentimentDipAlert {
  customer_id: number;
  customer_name: string;
  avg_score: number | null;
  negative_count: number;
  latest_key_quote: string | null;
  trend: SentimentTrend["trend"];
  alert_reason: string;
}

// ── Config ─────────────────────────────────────────────────────────────────

const DIP_THRESHOLD = -0.3;
const NEGATIVE_STREAK = 2;
const COOLDOWN_HOURS = 24;

// ── analyseSentiment ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a sentiment analysis assistant for a virtual assistant company.
Analyze the sentiment of the following customer comment.
Return ONLY a valid JSON object with exactly these keys:
{"sentiment": "positive"|"neutral"|"negative", "score": <float from -1.0 to 1.0>, "key_quote": "<exact short phrase from the comment that most indicates the sentiment>"}
Rules:
- score: -1.0 = extremely negative, 0.0 = neutral, 1.0 = extremely positive
- key_quote: max 60 characters, taken verbatim from the comment
- Return ONLY the JSON object, no other text`;

export async function analyseSentiment(
  commentText: string
): Promise<SentimentResult | null> {
  const text = (commentText || "").trim();
  if (!text || text.length < 5) {
    return { label: "neutral", score: 0.0, key_quote: "" };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const openai = createOpenAI({ apiKey });
    const { text: raw } = await generateText({
      model: openai("gpt-4o-mini"),
      system: SYSTEM_PROMPT,
      prompt: text.slice(0, 2000),
      maxOutputTokens: 150,
    });

    const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(clean);

    let label = String(parsed.sentiment ?? "neutral").toLowerCase() as SentimentResult["label"];
    if (!["positive", "neutral", "negative"].includes(label)) label = "neutral";

    let score = Number(parsed.score ?? 0.0);
    score = Math.max(-1.0, Math.min(1.0, score));

    const key_quote = String(parsed.key_quote ?? "").slice(0, 60);

    return { label, score, key_quote };
  } catch {
    return null;
  }
}

// ── getClientSentimentTrend ────────────────────────────────────────────────

export async function getClientSentimentTrend(
  customerId: number,
  days = 7
): Promise<SentimentTrend> {
  const empty: SentimentTrend = {
    avg_score: null, comment_count: 0, negative_count: 0,
    positive_count: 0, latest_key_quote: null, trend: null,
  };

  try {
    const since = new Date(Date.now() - days * 86400_000);

    const rows = await prisma.$queryRaw<
      { score: string | null; label: string | null; key_quote: string | null; happened_at: Date }[]
    >`
      SELECT
        payload->>'sentiment_score' AS score,
        payload->>'sentiment_label' AS label,
        payload->>'sentiment_key_quote' AS key_quote,
        happened_at
      FROM interactions
      WHERE customer_id = ${customerId}
        AND happened_at >= ${since}
        AND payload->>'sentiment_label' IS NOT NULL
      ORDER BY happened_at DESC
    `;

    if (!rows.length) return empty;

    const scores = rows.map(r => r.score != null ? parseFloat(r.score) : null).filter((s): s is number => s != null);
    const labels = rows.map(r => r.label).filter((l): l is string => !!l);

    const avg_score = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const negative_count = labels.filter(l => l === "negative").length;
    const positive_count = labels.filter(l => l === "positive").length;
    const latest_key_quote = rows[0]?.key_quote ?? null;

    let trend: SentimentTrend["trend"] = null;
    if (scores.length >= 4) {
      const mid = Math.floor(scores.length / 2);
      const recentAvg = scores.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
      const olderAvg = scores.slice(mid).reduce((a, b) => a + b, 0) / (scores.length - mid);
      const diff = recentAvg - olderAvg;
      if (diff > 0.15) trend = "improving";
      else if (diff < -0.15) trend = "declining";
      else trend = "stable";
    }

    return {
      avg_score: avg_score != null ? Math.round(avg_score * 100) / 100 : null,
      comment_count: rows.length,
      negative_count,
      positive_count,
      latest_key_quote,
      trend,
    };
  } catch {
    return empty;
  }
}

// ── checkSentimentDipAlerts ────────────────────────────────────────────────

export async function checkSentimentDipAlerts(): Promise<SentimentDipAlert[]> {
  const alerts: SentimentDipAlert[] = [];

  try {
    const customers = await prisma.customer.findMany({
      where: { active: true },
      select: { id: true, name: true },
    });

    const cooldownSince = new Date(Date.now() - COOLDOWN_HOURS * 3600_000);

    for (const cust of customers) {
      const trend = await getClientSentimentTrend(cust.id, 7);
      let alert_reason: string | null = null;

      if (trend.avg_score != null && trend.avg_score < DIP_THRESHOLD) {
        alert_reason = `7-day sentiment avg ${trend.avg_score.toFixed(2)} (threshold: ${DIP_THRESHOLD})`;
      } else if (trend.negative_count >= NEGATIVE_STREAK) {
        alert_reason = `${trend.negative_count} negative comments in 7 days`;
      }

      if (!alert_reason) continue;

      // Cooldown check: skip if we already alerted in the last 24h
      const recentAlert = await prisma.interaction.findFirst({
        where: {
          customer_id: cust.id,
          interaction_type: "sentiment_dip_alert",
          happened_at: { gte: cooldownSince },
        },
        select: { id: true },
      });
      if (recentAlert) continue;

      alerts.push({
        customer_id: cust.id,
        customer_name: cust.name,
        avg_score: trend.avg_score,
        negative_count: trend.negative_count,
        latest_key_quote: trend.latest_key_quote,
        trend: trend.trend,
        alert_reason,
      });
    }
  } catch {
    // swallow
  }

  return alerts;
}

// ── Slack formatting helpers ───────────────────────────────────────────────

export function formatSentimentLabel(result: SentimentResult): string {
  const emoji = { positive: "🟢", neutral: "🟡", negative: "🔴" }[result.label] ?? "⚪";
  const quote = result.key_quote ? ` — _"${result.key_quote}"_` : "";
  return `${emoji} Sentiment: ${result.label} (${result.score >= 0 ? "+" : ""}${result.score.toFixed(1)})${quote}`;
}