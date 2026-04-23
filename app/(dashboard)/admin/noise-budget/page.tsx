"use client";

import { useEffect, useState } from "react";
import { Radio, RefreshCw, Loader2 } from "lucide-react";

type ChannelCount = {
  posts_today: number;
  daily_cap: number;
  remaining: number;
};

type BudgetResponse = {
  ok: boolean;
  date: string;
  channels: Record<string, ChannelCount>;
  total_channels: number;
};

function pct(used: number, cap: number) {
  if (cap <= 0) return 0;
  return Math.min(100, Math.round((used / cap) * 100));
}

export default function NoiseBudgetPage() {
  const [data, setData] = useState<BudgetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/noise-budget");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Radio className="w-6 h-6 text-blue-500" />
          Noise Budget
        </h1>
        <div className="flex items-center gap-3">
          {data && (
            <span className="text-sm text-gray-400">
              {new Date(data.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        <strong>Note:</strong> Counts are per-serverless-instance in-memory state. A cold start resets all counters to zero even if posts went out in prior instances.
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      )}

      {data && Object.keys(data.channels).length === 0 && (
        <div className="bg-white rounded-lg border shadow-sm p-12 text-center">
          <Radio className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No channel activity recorded this instance.</p>
          <p className="text-xs text-gray-400 mt-1">Counters start from zero on each serverless cold start.</p>
        </div>
      )}

      {data && Object.keys(data.channels).length > 0 && (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-gray-50">
            <span className="text-sm font-medium text-gray-700">
              Channel Post Counts ({data.total_channels} channels)
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {["Channel", "Posts Today", "Daily Cap", "Remaining", "Usage"].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {Object.entries(data.channels)
                .sort(([, a], [, b]) => b.posts_today - a.posts_today)
                .map(([channel, counts]) => {
                  const used = counts.posts_today;
                  const cap = counts.daily_cap;
                  const usage = pct(used, cap);
                  return (
                    <tr key={channel} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{channel}</td>
                      <td className="px-4 py-2.5 text-gray-900 font-medium">{used}</td>
                      <td className="px-4 py-2.5 text-gray-500">{cap > 0 ? cap : "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className={`font-medium ${counts.remaining <= 0 ? "text-red-600" : counts.remaining <= 3 ? "text-amber-600" : "text-emerald-600"}`}>
                          {cap > 0 ? counts.remaining : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 w-36">
                        {cap > 0 ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                              <div
                                className={`h-1.5 rounded-full transition-all ${
                                  usage >= 90 ? "bg-red-500" : usage >= 60 ? "bg-amber-400" : "bg-emerald-400"
                                }`}
                                style={{ width: `${usage}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500 w-8 text-right">{usage}%</span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">No cap</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}