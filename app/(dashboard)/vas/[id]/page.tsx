import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Users } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

function scoreVariant(score: number | null): "success" | "warning" | "danger" | "muted" {
  if (score == null) return "muted";
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  return "danger";
}

export default async function VaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id: rawId } = await params;
  const vaId = parseInt(rawId);

  const va = await prisma.va.findUnique({
    where: { id: vaId },
    select: {
      id: true,
      display_name: true,
      email: true,
      slack_user_id: true,
      basecamp_person_id: true,
      clockify_user_id: true,
      active: true,
      reliability_score: true,
      capacity_index: true,
      last_scored_at: true,
      created_at: true,
    },
  });

  if (!va) {
    return (
      <div className="max-w-4xl mx-auto py-16 text-center text-gray-400">
        VA not found.{" "}
        <Link href="/vas" className="text-blue-600 hover:underline">
          Back to Team
        </Link>
      </div>
    );
  }

  // Weekly metrics (last 8 weeks)
  const weeklyMetrics = await prisma.vaWeeklyMetric.findMany({
    where: { slack_user_id: va.slack_user_id ?? "__none__" },
    orderBy: { week_start: "desc" },
    take: 8,
    select: {
      week_start: true,
      interested_count: true,
      selected_count: true,
      assigned_count: true,
      completed_count: true,
      avg_selection_rank: true,
    },
  });

  // Recent task assignments
  const recentAssignments = await prisma.taskOwnership.findMany({
    where: { responsible_va_id: vaId, active: true },
    orderBy: { assigned_at: "desc" },
    take: 20,
    select: {
      id: true,
      todo_id: true,
      customer_id: true,
      assigned_at: true,
      unassigned_at: true,
      active: true,
    },
  });

  // Recent time entries
  const recentTime = await prisma.timeEntry.findMany({
    where: { va_id: vaId },
    orderBy: { created_at: "desc" },
    take: 10,
    select: {
      id: true,
      customer_id: true,
      duration_minutes: true,
      description: true,
      status: true,
      created_at: true,
    },
  });

  const totalMinutes = recentTime.reduce(
    (sum, e) => sum + Number(e.duration_minutes ?? 0),
    0
  );

  // Scorecard (latest)
  const latestScorecard = await prisma.vaWeeklyScorecard.findFirst({
    where: { slack_user_id: va.slack_user_id ?? "__none__" },
    orderBy: { week_start: "desc" },
    select: { week_start: true, scorecard_text: true, scorecard_json: true },
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/vas" className="flex items-center gap-1 hover:text-blue-600">
          <ArrowLeft className="w-4 h-4" />
          Team
        </Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">{va.display_name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
            <Users className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{va.display_name}</h1>
            <p className="text-sm text-gray-500">{va.email ?? "No email"}</p>
          </div>
        </div>
        <Badge variant={va.active ? "success" : "muted"}>
          {va.active ? "Active" : "Inactive"}
        </Badge>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Reliability Score"
          value={va.reliability_score != null ? `${va.reliability_score}%` : "—"}
          variant={scoreVariant(va.reliability_score)}
        />
        <KpiCard
          label="Capacity Index"
          value={va.capacity_index ?? "—"}
          variant="default"
        />
        <KpiCard
          label="Active Assignments"
          value={recentAssignments.length}
          variant="info"
        />
        <KpiCard
          label="Recent Hours"
          value={`${(totalMinutes / 60).toFixed(1)} h`}
          variant="default"
          subtext="last 10 entries"
        />
      </div>

      {/* Details + integrations */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Details
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Member since</dt>
              <dd className="font-medium text-gray-800">
                {va.created_at.toLocaleDateString()}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Last scored</dt>
              <dd className="font-medium text-gray-800">
                {va.last_scored_at?.toLocaleDateString() ?? "—"}
              </dd>
            </div>
          </dl>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Integrations
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Slack</span>
              {va.slack_user_id ? (
                <Badge variant="info">{va.slack_user_id}</Badge>
              ) : (
                <span className="text-gray-300">—</span>
              )}
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Basecamp</span>
              {va.basecamp_person_id ? (
                <Badge variant="success">{va.basecamp_person_id}</Badge>
              ) : (
                <span className="text-gray-300">—</span>
              )}
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Clockify</span>
              {va.clockify_user_id ? (
                <Badge variant="default">{va.clockify_user_id}</Badge>
              ) : (
                <span className="text-gray-300">—</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Weekly metrics table */}
      {weeklyMetrics.length > 0 && (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-700">Weekly Job Board Metrics</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Week</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Interested</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Selected</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Assigned</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Completed</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Avg Rank</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {weeklyMetrics.map((m) => (
                <tr key={m.week_start.toISOString()} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-700">
                    {m.week_start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </td>
                  <td className="px-4 py-2.5 text-center text-gray-600">{m.interested_count}</td>
                  <td className="px-4 py-2.5 text-center text-gray-600">{m.selected_count}</td>
                  <td className="px-4 py-2.5 text-center text-gray-600">{m.assigned_count}</td>
                  <td className="px-4 py-2.5 text-center font-medium text-emerald-600">{m.completed_count}</td>
                  <td className="px-4 py-2.5 text-center text-gray-500">
                    {m.avg_selection_rank != null ? Number(m.avg_selection_rank).toFixed(1) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* AI Scorecard (latest) */}
      {latestScorecard && (
        <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              AI Weekly Scorecard
            </h2>
            <span className="text-xs text-gray-400">
              Week of{" "}
              {latestScorecard.week_start.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
          {latestScorecard.scorecard_text ? (
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
              {latestScorecard.scorecard_text}
            </p>
          ) : (
            <p className="text-sm text-gray-400">No scorecard text available.</p>
          )}
        </div>
      )}

      {/* Recent time entries */}
      {recentTime.length > 0 && (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Recent Time Entries</h2>
            <Link
              href={`/time-tracking?va_id=${vaId}`}
              className="text-xs text-blue-600 hover:underline"
            >
              View all
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Customer</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Duration</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Description</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentTime.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-600">{e.customer_id}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">
                    {(Number(e.duration_minutes) / 60).toFixed(2)} h
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 max-w-xs truncate">
                    {e.description ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge
                      variant={
                        e.status === "approved" ? "success" :
                        e.status === "rejected" ? "danger" :
                        e.status === "pending" ? "warning" : "muted"
                      }
                    >
                      {e.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">
                    {e.created_at.toLocaleDateString()}
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
