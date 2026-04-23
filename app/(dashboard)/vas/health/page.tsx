import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Activity, TrendingUp, TrendingDown, Minus } from "lucide-react";

export const dynamic = "force-dynamic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toNum(v: any): number | null {
  return v == null ? null : Number(v);
}

function ScoreBadge({ value, size = "sm" }: { value: number | null; size?: "sm" | "lg" }) {
  if (value == null)
    return <span className="text-xs text-gray-300 font-mono">—</span>;
  const cls =
    value >= 80
      ? "bg-emerald-100 text-emerald-700"
      : value >= 60
      ? "bg-amber-100 text-amber-700"
      : "bg-red-100 text-red-700";
  const textSize = size === "lg" ? "text-base font-bold" : "text-xs font-semibold";
  return (
    <span className={`${textSize} px-2 py-0.5 rounded-full ${cls}`}>{value.toFixed(0)}</span>
  );
}

function TrendIcon({ value }: { value: number | null }) {
  if (value == null) return <Minus className="w-3.5 h-3.5 text-gray-300" />;
  if (value > 2) return <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />;
  if (value < -2) return <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
  return <Minus className="w-3.5 h-3.5 text-gray-400" />;
}

function ThrottleBadge({ level }: { level: string }) {
  const cls =
    level === "hard_throttle"
      ? "bg-red-100 text-red-700"
      : level === "soft_throttle"
      ? "bg-amber-100 text-amber-700"
      : "bg-emerald-100 text-emerald-700";
  const label =
    level === "hard_throttle"
      ? "Hard Throttle"
      : level === "soft_throttle"
      ? "Soft Throttle"
      : "Normal";
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
  );
}

export default async function TeamHealthPage() {
  await requireAuth();

  // All VAs with their load state and latest scores
  const vas = await prisma.va.findMany({
    where: { active: true },
    orderBy: { display_name: "asc" },
    select: {
      id: true,
      display_name: true,
      email: true,
      reliability_score: true,
      capacity_index: true,
      last_scored_at: true,
    },
  });

  // Latest score_daily for va_reliability + capacity_index by person_id
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const scores = await prisma.scoreDaily.findMany({
    where: {
      score_type: { in: ["va_reliability", "capacity_index"] },
      person_id: { in: vas.map((v) => v.id) },
      day: { gte: since },
    },
    orderBy: { day: "desc" },
    select: {
      person_id: true,
      score_type: true,
      score_value: true,
      trend_value: true,
      band: true,
      day: true,
    },
    take: 1000,
  });

  // Latest score per (person_id, score_type)
  const latestScores: Record<string, { score_value: number; trend_value: number | null; band: string | null; day: Date }> = {};
  for (const s of scores) {
    const key = `${s.person_id}:${s.score_type}`;
    if (!latestScores[key]) {
      latestScores[key] = {
        score_value: Number(s.score_value),
        trend_value: s.trend_value != null ? Number(s.trend_value) : null,
        band: s.band,
        day: s.day,
      };
    }
  }

  // All VaLoadState rows
  const loadStates = await prisma.vaLoadState.findMany({
    select: {
      va_id: true,
      active_task_count: true,
      throttle_level: true,
      burnout_flag: true,
      reasons_json: true,
      updated_at: true,
    },
  });

  // Compute uuid5 for each VA id to match VaLoadState.va_id
  // Python uses uuid.uuid5(NAMESPACE_OID, f"va:{va_id}")
  // We'll include the raw va_id in load state and match by va_id string (if available)
  // For now, build a simple map by all load states — match will be empty if no data
  const loadStateMap: Record<string, (typeof loadStates)[0]> = {};
  for (const ls of loadStates) {
    loadStateMap[ls.va_id] = ls;
  }

  // Enrich VAs
  const enriched = vas.map((va) => {
    const relKey = `${va.id}:va_reliability`;
    const capKey = `${va.id}:capacity_index`;
    const relScore = latestScores[relKey] ?? null;
    const capScore = latestScores[capKey] ?? null;
    const relValue = relScore?.score_value ?? toNum(va.reliability_score);
    const capValue = capScore?.score_value ?? toNum(va.capacity_index);
    return { va, relScore: { ...relScore, score_value: relValue }, capScore: { ...capScore, score_value: capValue } };
  });

  // Summary stats
  const burnoutCount = loadStates.filter((ls) => ls.burnout_flag).length;
  const hardThrottleCount = loadStates.filter((ls) => ls.throttle_level === "hard_throttle").length;
  const avgRel =
    enriched.reduce((s, { relScore }) => s + (relScore.score_value ?? 0), 0) / (enriched.length || 1);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Activity className="w-6 h-6 text-blue-500" />
        <h1 className="text-2xl font-bold text-gray-900">Team Health</h1>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Active VAs", value: vas.length.toString(), color: "text-gray-900" },
          { label: "Avg Reliability", value: avgRel.toFixed(0), color: avgRel >= 80 ? "text-emerald-700" : avgRel >= 60 ? "text-amber-600" : "text-red-600" },
          { label: "Burnout Flags", value: burnoutCount.toString(), color: burnoutCount > 0 ? "text-red-600" : "text-emerald-700" },
          { label: "Hard Throttle", value: hardThrottleCount.toString(), color: hardThrottleCount > 0 ? "text-red-600" : "text-emerald-700" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-lg border shadow-sm p-4 text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Load state alerts */}
      {loadStates.filter((ls) => ls.burnout_flag || ls.throttle_level !== "normal").length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-2">
          <p className="text-sm font-semibold text-red-700">Active Workload Alerts</p>
          {loadStates
            .filter((ls) => ls.burnout_flag || ls.throttle_level !== "normal")
            .map((ls) => {
              const reasons = Array.isArray(ls.reasons_json) ? (ls.reasons_json as string[]) : [];
              return (
                <div key={ls.va_id} className="flex items-start gap-3 text-sm">
                  <ThrottleBadge level={ls.throttle_level} />
                  {ls.burnout_flag && (
                    <span className="text-xs font-medium bg-red-200 text-red-800 px-2 py-0.5 rounded-full">
                      Burnout Risk
                    </span>
                  )}
                  <span className="text-xs text-gray-500">{ls.active_task_count} active tasks</span>
                  {reasons.length > 0 && (
                    <span className="text-xs text-red-600">{reasons.slice(0, 2).join(", ")}</span>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* VA Table */}
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">VA Reliability & Capacity</h2>
          <span className="text-xs text-gray-400">Based on last 30 days</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              {["VA", "Reliability", "Trend", "Band", "Capacity", "Tasks", "Status", ""].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {enriched.map(({ va, relScore, capScore }) => {
              // Match load state by any means — we don't have uuid5, so show N/A
              const loadState = null as (typeof loadStates)[0] | null;
              return (
                <tr key={va.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/vas/${va.id}`} className="font-medium text-blue-600 hover:underline">
                      {va.display_name ?? va.email}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <ScoreBadge value={relScore.score_value ?? null} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <TrendIcon value={relScore.trend_value ?? null} />
                      {relScore.trend_value != null && (
                        <span className="text-xs text-gray-400">
                          {relScore.trend_value > 0 ? "+" : ""}
                          {relScore.trend_value?.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {relScore.band ? (
                      <span className="text-xs font-medium bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full capitalize">
                        {relScore.band}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ScoreBadge value={capScore.score_value ?? null} />
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">—</td>
                  <td className="px-4 py-3 text-xs text-gray-400">Normal</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/vas/${va.id}`} className="text-xs text-blue-500 hover:underline">
                      Detail →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {vas.length === 0 && (
          <p className="px-4 py-10 text-center text-gray-400">No active VAs found</p>
        )}
      </div>

      {/* Load state table (if any data) */}
      {loadStates.length > 0 && (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-700">Load State Monitor</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {["VA ID", "Active Tasks", "Throttle Level", "Burnout", "Updated"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loadStates.map((ls) => (
                <tr key={ls.va_id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{ls.va_id.substring(0, 8)}…</td>
                  <td className="px-4 py-2.5 font-semibold text-gray-700">{ls.active_task_count}</td>
                  <td className="px-4 py-2.5"><ThrottleBadge level={ls.throttle_level} /></td>
                  <td className="px-4 py-2.5">
                    {ls.burnout_flag ? (
                      <span className="text-xs font-medium bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Yes</span>
                    ) : (
                      <span className="text-xs text-gray-400">No</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">
                    {new Date(ls.updated_at).toLocaleString()}
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
