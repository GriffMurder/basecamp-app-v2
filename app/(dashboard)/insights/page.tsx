import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { BarChart2, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  await requireAuth();

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    openInterventions,
    recentInterventions,
    latestBrief,
    scoreSummary,
  ] = await Promise.all([
    prisma.intervention.count({ where: { status: "open" } }),
    prisma.intervention.findMany({
      where: { created_at: { gte: weekAgo } },
      orderBy: { created_at: "desc" },
      take: 20,
      select: {
        id: true, level: true, reason: true, status: true,
        target_person_id: true, customer_id: true,
        created_at: true, sla_due_at: true,
      },
    }),
    prisma.opsWeeklyBrief.findFirst({
      orderBy: { week_start: "desc" },
      select: { week_start: true, brief_text: true, generated_at: true },
    }),
    prisma.scoreDaily.groupBy({
      by: ["score_type"],
      where: { day: { gte: weekAgo } },
      _avg: { score_value: true },
      _count: { id: true },
    }),
  ]);

  function levelVariant(level: string): "danger" | "warning" | "info" | "muted" {
    if (level === "critical" || level === "high") return "danger";
    if (level === "medium") return "warning";
    if (level === "low") return "info";
    return "muted";
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        <BarChart2 className="w-6 h-6 text-blue-500" />
        Ops Insights
      </h1>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Open Escalations"
          value={openInterventions}
          variant={openInterventions > 0 ? "danger" : "success"}
        />
        <KpiCard
          label="New This Week"
          value={recentInterventions.length}
          variant={recentInterventions.length > 3 ? "warning" : "default"}
        />
        {scoreSummary.slice(0, 2).map((s) => (
          <KpiCard
            key={s.score_type}
            label={s.score_type.replace(/_/g, " ")}
            value={s._avg.score_value != null ? Math.round(Number(s._avg.score_value)) : "—"}
            variant="info"
            subtext={`${s._count.id} scores`}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Interventions */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h2 className="text-sm font-semibold text-gray-900">Recent Escalations (7d)</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Level</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Reason</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentInterventions.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-400">No escalations this week</td>
                </tr>
              )}
              {recentInterventions.map((i) => (
                <tr key={String(i.id)} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <Badge variant={levelVariant(i.level)}>{i.level}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 max-w-xs truncate">{i.reason}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={i.status === "open" ? "warning" : "success"}>{i.status}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {i.created_at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Weekly ops brief */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Weekly Ops Brief</h2>
            {latestBrief && (
              <p className="text-xs text-gray-400 mt-0.5">
                Week of {latestBrief.week_start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · generated {latestBrief.generated_at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </p>
            )}
          </div>
          <div className="p-5">
            {latestBrief?.brief_text ? (
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{latestBrief.brief_text}</p>
            ) : (
              <p className="text-sm text-gray-400 italic">No weekly brief generated yet. Run the weekly ops cron to generate one.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}