import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BarChart2, CheckCircle, Clock, AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

function pct(n: number | null, d: number): string {
  if (d === 0 || n === null) return "—";
  return ((n / d) * 100).toFixed(1) + "%";
}

async function getMetrics() {
  const rows = await prisma.$queryRaw<
    {
      task_type: string;
      total: bigint;
      posted: bigint;
      avg_hours_to_post: number | null;
      avg_edits_before_approval: number | null;
      reports_with_blockers: bigint;
    }[]
  >`
    SELECT
      task_type,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'posted') AS posted,
      ROUND(AVG(
        EXTRACT(EPOCH FROM (posted_at - completed_at)) / 3600.0
      ) FILTER (WHERE posted_at IS NOT NULL AND completed_at IS NOT NULL)::numeric, 2) AS avg_hours_to_post,
      ROUND(AVG(edit_count) FILTER (WHERE status IN ('approved', 'posted'))::numeric, 2) AS avg_edits_before_approval,
      COUNT(*) FILTER (
        WHERE approved_report IS NOT NULL
          AND jsonb_array_length(COALESCE(approved_report->'blockers', '[]'::jsonb)) > 0
      ) AS reports_with_blockers
    FROM task_completion_reports
    GROUP BY task_type
    ORDER BY total DESC
  `;

  return rows.map((r) => ({
    task_type: r.task_type,
    total: Number(r.total),
    posted: Number(r.posted),
    avg_hours_to_post: r.avg_hours_to_post != null ? Number(r.avg_hours_to_post) : null,
    avg_edits: r.avg_edits_before_approval != null ? Number(r.avg_edits_before_approval) : null,
    blockers: Number(r.reports_with_blockers),
  }));
}

export default async function AcsMetricsPage() {
  await requireAuth();
  const rows = await getMetrics();

  const totalReports = rows.reduce((s, r) => s + r.total, 0);
  const totalPosted = rows.reduce((s, r) => s + r.posted, 0);
  const totalBlockers = rows.reduce((s, r) => s + r.blockers, 0);
  const avgHours =
    rows.filter((r) => r.avg_hours_to_post != null).reduce((s, r) => s + (r.avg_hours_to_post ?? 0), 0) /
    (rows.filter((r) => r.avg_hours_to_post != null).length || 1);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <BarChart2 className="w-6 h-6 text-blue-500" />
        <h1 className="text-2xl font-bold text-gray-900">ACS Metrics</h1>
        <span className="text-xs text-gray-400 ml-1">Phase 6 reporting quality</span>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Total Reports",
            value: totalReports.toLocaleString(),
            icon: CheckCircle,
            color: "text-blue-500",
          },
          {
            label: "Post Rate",
            value: pct(totalPosted, totalReports),
            icon: CheckCircle,
            color: "text-emerald-500",
          },
          {
            label: "Avg Time to Post",
            value: isNaN(avgHours) ? "—" : `${avgHours.toFixed(1)}h`,
            icon: Clock,
            color: "text-amber-500",
          },
          {
            label: "Blocker Rate",
            value: pct(totalBlockers, totalReports),
            icon: AlertCircle,
            color: "text-red-500",
          },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-lg border shadow-sm p-4">
            <div className={`${color} mb-1`}>
              <Icon className="w-4 h-4" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Breakdown table */}
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Breakdown by Task Type</h2>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-gray-400">No task completion reports yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {["Task Type", "Total", "Posted", "Post Rate", "Avg Time to Post", "Avg Edits", "Blocker Rate"].map(
                  (h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.task_type} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-800 capitalize">
                    {r.task_type.replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{r.total.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-gray-600">{r.posted.toLocaleString()}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        r.total > 0 && r.posted / r.total >= 0.8
                          ? "bg-emerald-100 text-emerald-700"
                          : r.total > 0 && r.posted / r.total >= 0.5
                          ? "bg-amber-100 text-amber-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {pct(r.posted, r.total)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {r.avg_hours_to_post != null ? `${r.avg_hours_to_post.toFixed(1)}h` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {r.avg_edits != null ? r.avg_edits.toFixed(1) : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        r.blockers === 0
                          ? "bg-emerald-100 text-emerald-700"
                          : r.total > 0 && r.blockers / r.total < 0.2
                          ? "bg-amber-100 text-amber-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {pct(r.blockers, r.total)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
