import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { Users, Search } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function VasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; inactive?: string }>;
}) {
  await requireAuth();

  const { q: rawQ, inactive } = await searchParams;
  const q = rawQ ?? "";
  const showInactive = inactive === "1";

  const [vas, avgScore] = await Promise.all([
    prisma.va.findMany({
      where: {
        active: showInactive ? undefined : true,
        ...(q ? { display_name: { contains: q, mode: "insensitive" } } : {}),
      },
      orderBy: { display_name: "asc" },
      select: {
        id: true, display_name: true, email: true,
        slack_user_id: true, basecamp_person_id: true,
        reliability_score: true, capacity_index: true, last_scored_at: true,
        created_at: true, active: true,
      },
    }),
    prisma.va.aggregate({
      where: { active: true, reliability_score: { not: null } },
      _avg: { reliability_score: true },
    }),
  ]);

  const avgRel = avgScore._avg.reliability_score
    ? Math.round(Number(avgScore._avg.reliability_score))
    : null;

  function scoreVariant(score: number | null): "success" | "warning" | "danger" | "muted" {
    if (score == null) return "muted";
    if (score >= 80) return "success";
    if (score >= 60) return "warning";
    return "danger";
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Users className="w-6 h-6 text-blue-500" />
          Team
        </h1>
        <div className="flex items-center gap-2">
          <form method="GET" className="relative flex items-center">
            <Search className="absolute left-2.5 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search VAs…"
              className="pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 w-44"
            />
            {showInactive && <input type="hidden" name="inactive" value="1" />}
          </form>
          <Link
            href={showInactive ? `/vas${q ? `?q=${encodeURIComponent(q)}` : ""}` : `/vas?inactive=1${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 whitespace-nowrap"
          >
            {showInactive ? "Active only" : "Show inactive"}
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <KpiCard label="Active VAs" value={vas.length} variant="success" />
        <KpiCard
          label="Avg Reliability"
          value={avgRel != null ? `${avgRel}%` : "—"}
          variant={avgRel == null ? "muted" : avgRel >= 80 ? "success" : avgRel >= 60 ? "warning" : "danger"}
        />
        <KpiCard
          label="Scored Today"
          value={vas.filter(v => v.last_scored_at && new Date(v.last_scored_at).toDateString() === new Date().toDateString()).length}
          variant="info"
        />
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
              <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Reliability</th>
              <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Capacity</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Last Scored</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Integrations</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {vas.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">No active VAs found</td>
              </tr>
            )}
            {vas.map((v) => (
              <tr key={v.id} className={`hover:bg-gray-50 ${!v.active ? "opacity-60" : ""}`}>
                <td className="px-4 py-2.5 font-medium text-gray-900">
                  <Link href={`/vas/${v.id}`} className="hover:text-blue-600 hover:underline">
                    {v.display_name}
                  </Link>
                  {!v.active && <span className="ml-1 text-xs text-gray-400">(inactive)</span>}
                </td>
                <td className="px-4 py-2.5 text-gray-500 text-xs">{v.email ?? "—"}</td>
                <td className="px-4 py-2.5 text-center">
                  {v.reliability_score != null ? (
                    <Badge variant={scoreVariant(v.reliability_score)}>{v.reliability_score}%</Badge>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-2.5 text-center text-gray-600">{v.capacity_index ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500">
                  {v.last_scored_at
                    ? v.last_scored_at.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                    : "—"}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1">
                    {v.slack_user_id && <Badge variant="info">Slack</Badge>}
                    {v.basecamp_person_id && <Badge variant="success">BC</Badge>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}