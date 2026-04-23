import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { FileText } from "lucide-react";

export const dynamic = "force-dynamic";

function statusVariant(status: string): "success" | "default" | "warning" | "danger" | "muted" {
  if (status === "posted") return "success";
  if (status === "approved") return "default";
  if (status === "drafted") return "warning";
  if (status === "failed") return "danger";
  return "muted";
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { status?: string; q?: string };
}) {
  await requireAuth();

  const filterStatus = searchParams.status ?? "";
  const q = searchParams.q ?? "";

  const [reports, counts] = await Promise.all([
    prisma.taskCompletionReport.findMany({
      where: {
        ...(filterStatus ? { status: filterStatus } : {}),
        ...(q ? { basecamp_thread_id: { contains: q } } : {}),
      },
      orderBy: { created_at: "desc" },
      take: 100,
      select: {
        id: true, basecamp_thread_id: true, task_type: true, status: true,
        created_at: true, posted_at: true, approved_at: true, error: true,
        edit_count: true,
      },
    }),
    prisma.taskCompletionReport.groupBy({
      by: ["status"],
      _count: { id: true },
    }),
  ]);

  const countMap = counts.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = c._count.id;
    return acc;
  }, {});

  const statuses = ["drafted", "approved", "posted", "failed"];

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileText className="w-6 h-6 text-blue-500" />
          Completion Reports
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">ACS task completion reports by status</p>
      </div>

      {/* Status KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statuses.map((s) => (
          <KpiCard
            key={s}
            label={s.charAt(0).toUpperCase() + s.slice(1)}
            value={countMap[s] ?? 0}
            variant={statusVariant(s)}
          />
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <a
          href="/reports"
          className={`px-3 py-1.5 rounded-md text-sm border ${!filterStatus ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}
        >
          All
        </a>
        {statuses.map((s) => (
          <a
            key={s}
            href={`/reports?status=${s}`}
            className={`px-3 py-1.5 rounded-md text-sm border ${filterStatus === s ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)} ({countMap[s] ?? 0})
          </a>
        ))}
      </div>

      {/* Reports table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-sm text-gray-500">{reports.length} report{reports.length !== 1 ? "s" : ""}</p>
        </div>
        {reports.length === 0 ? (
          <p className="px-4 py-8 text-sm text-gray-400 text-center">No reports found</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-2 text-xs text-gray-500 uppercase">Thread ID</th>
                <th className="text-left px-4 py-2 text-xs text-gray-500 uppercase">Type</th>
                <th className="text-left px-4 py-2 text-xs text-gray-500 uppercase">Status</th>
                <th className="text-right px-4 py-2 text-xs text-gray-500 uppercase">Edits</th>
                <th className="text-left px-4 py-2 text-xs text-gray-500 uppercase">Created</th>
                <th className="text-left px-4 py-2 text-xs text-gray-500 uppercase">Posted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reports.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-600 max-w-[180px] truncate">
                    {r.basecamp_thread_id}
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 capitalize">{r.task_type}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-500">{r.edit_count}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">
                    {r.created_at.toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">
                    {r.posted_at ? r.posted_at.toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
              {reports.some(r => r.error) && reports.filter(r => r.error).map((r) => (
                <tr key={`err-${r.id}`} className="bg-red-50">
                  <td colSpan={6} className="px-4 py-1.5 text-xs text-red-600">
                    ↳ Error: {r.error}
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
