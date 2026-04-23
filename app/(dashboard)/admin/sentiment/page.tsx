import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Smile, TrendingDown, TrendingUp, Minus, AlertTriangle, MessageCircle } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

type SentimentRow = {
  customer_id: number;
  customer_name: string;
  avg_score: number | null;
  comment_count: number;
  negative_count: number;
  positive_count: number;
  latest_key_quote: string | null;
  latest_happened_at: Date | null;
  trend: string | null;
};

async function getSentimentData(): Promise<SentimentRow[]> {
  const customers = await prisma.customer.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const since = new Date(Date.now() - 7 * 86400_000);

  const rows = await prisma.$queryRaw<
    {
      customer_id: number;
      avg_score: number | null;
      comment_count: bigint;
      negative_count: bigint;
      positive_count: bigint;
      latest_key_quote: string | null;
      latest_happened_at: Date | null;
    }[]
  >`
    SELECT
      customer_id,
      ROUND(AVG((payload->>'sentiment_score')::numeric)::numeric, 2) AS avg_score,
      COUNT(*)::bigint AS comment_count,
      COUNT(*) FILTER (WHERE payload->>'sentiment_label' = 'negative')::bigint AS negative_count,
      COUNT(*) FILTER (WHERE payload->>'sentiment_label' = 'positive')::bigint AS positive_count,
      (ARRAY_AGG(payload->>'sentiment_key_quote' ORDER BY happened_at DESC) FILTER (WHERE payload->>'sentiment_key_quote' IS NOT NULL))[1] AS latest_key_quote,
      MAX(happened_at) AS latest_happened_at
    FROM interactions
    WHERE interaction_type = 'customer_comment_sentiment'
      AND happened_at >= ${since}
      AND payload->>'sentiment_label' IS NOT NULL
    GROUP BY customer_id
  `;

  const rowMap = new Map(rows.map(r => [r.customer_id, r]));

  return customers
    .map(c => {
      const r = rowMap.get(c.id);
      if (!r) {
        return {
          customer_id: c.id,
          customer_name: c.name,
          avg_score: null,
          comment_count: 0,
          negative_count: 0,
          positive_count: 0,
          latest_key_quote: null,
          latest_happened_at: null,
          trend: null,
        };
      }
      const avgScore = r.avg_score != null ? Number(r.avg_score) : null;
      let trend: string | null = null;
      if (avgScore != null) {
        if (avgScore > 0.15) trend = "improving";
        else if (avgScore < -0.15) trend = "declining";
        else trend = "stable";
      }
      return {
        customer_id: c.id,
        customer_name: c.name,
        avg_score: avgScore,
        comment_count: Number(r.comment_count),
        negative_count: Number(r.negative_count),
        positive_count: Number(r.positive_count),
        latest_key_quote: r.latest_key_quote ?? null,
        latest_happened_at: r.latest_happened_at ?? null,
        trend,
      };
    })
    .filter(r => r.comment_count > 0)
    .sort((a, b) => (a.avg_score ?? 0) - (b.avg_score ?? 0)); // worst first
}

function ScoreChip({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-gray-400">—</span>;
  const cls =
    score >= 0.3 ? "bg-emerald-100 text-emerald-700"
    : score >= 0 ? "bg-gray-100 text-gray-600"
    : score >= -0.3 ? "bg-amber-100 text-amber-700"
    : "bg-red-100 text-red-700";
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>
      {score >= 0 ? "+" : ""}{score.toFixed(2)}
    </span>
  );
}

function TrendIcon({ trend }: { trend: string | null }) {
  if (!trend) return <span className="text-gray-400">—</span>;
  if (trend === "improving") return <TrendingUp className="w-4 h-4 text-emerald-500" />;
  if (trend === "declining") return <TrendingDown className="w-4 h-4 text-red-500" />;
  return <Minus className="w-4 h-4 text-gray-400" />;
}

function timeAgo(d: Date | null): string {
  if (!d) return "—";
  const diff = Date.now() - new Date(d).getTime();
  const h = Math.floor(diff / 3600_000);
  if (h < 1) return "< 1h ago";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default async function SentimentPage() {
  await requireAuth();
  const rows = await getSentimentData();

  const alerts = rows.filter(r => r.avg_score != null && r.avg_score < -0.3);
  const total = rows.length;
  const avgAll = rows.length > 0
    ? rows.filter(r => r.avg_score != null).reduce((s, r) => s + (r.avg_score ?? 0), 0) /
      Math.max(rows.filter(r => r.avg_score != null).length, 1)
    : null;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Smile className="w-6 h-6 text-amber-500" />
          <h1 className="text-2xl font-bold text-gray-900">Client Sentiment</h1>
          <span className="text-xs text-gray-400 ml-1">7-day rolling — scored by AI daily</span>
        </div>
        <Link href="/admin/triggers" className="text-sm text-blue-600 hover:underline">
          Trigger scan →
        </Link>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border shadow-sm p-4 text-center">
          <p className="text-xs text-gray-500 mb-1">Clients Scored</p>
          <p className="text-2xl font-bold text-gray-900">{total}</p>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4 text-center">
          <p className="text-xs text-gray-500 mb-1">Portfolio Avg (7d)</p>
          <p className="text-2xl font-bold text-gray-900">
            {avgAll != null ? (avgAll >= 0 ? "+" : "") + avgAll.toFixed(2) : "—"}
          </p>
        </div>
        <div className={`rounded-lg border shadow-sm p-4 text-center ${alerts.length > 0 ? "bg-red-50 border-red-200" : "bg-white"}`}>
          <p className="text-xs text-gray-500 mb-1 flex items-center justify-center gap-1">
            {alerts.length > 0 && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
            Dip Alerts
          </p>
          <p className={`text-2xl font-bold ${alerts.length > 0 ? "text-red-600" : "text-gray-900"}`}>
            {alerts.length}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-lg border shadow-sm p-12 text-center">
          <MessageCircle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No sentiment data yet. Run the Sentiment Scan to score recent comments.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {["Client", "Avg Score (7d)", "Trend", "Comments", "Positive", "Negative", "Latest Quote", "Last Active"].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => (
                <tr key={r.customer_id} className={`hover:bg-gray-50 ${r.avg_score != null && r.avg_score < -0.3 ? "bg-red-50/40" : ""}`}>
                  <td className="px-3 py-2.5 font-medium text-gray-900 max-w-[160px] truncate">
                    <Link href={`/customers/${r.customer_id}`} className="hover:text-blue-600">
                      {r.customer_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <ScoreChip score={r.avg_score} />
                  </td>
                  <td className="px-3 py-2.5">
                    <TrendIcon trend={r.trend} />
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">{r.comment_count}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-xs text-emerald-600 font-medium">{r.positive_count}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    {r.negative_count > 0 ? (
                      <span className="text-xs text-red-600 font-medium">{r.negative_count}</span>
                    ) : (
                      <span className="text-xs text-gray-400">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 max-w-[220px]">
                    {r.latest_key_quote ? (
                      <p className="text-xs italic text-gray-500 truncate">"{r.latest_key_quote}"</p>
                    ) : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-400 whitespace-nowrap">
                    {timeAgo(r.latest_happened_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}