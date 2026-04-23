import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle, AlertCircle, FileText } from "lucide-react";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
};

function statusVariant(status: string): "muted" | "warning" | "success" | "danger" | "default" {
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  if (status === "pending") return "warning";
  return "muted";
}

export default async function TimeTrackingPage({
  searchParams,
}: {
  searchParams: { status?: string; page?: string };
}) {
  await requireAuth();

  const filterStatus = searchParams.status ?? "";
  const page = Math.max(1, parseInt(searchParams.page ?? "1"));
  const pageSize = 50;

  const where: Record<string, unknown> = {};
  if (filterStatus) where.status = filterStatus;

  const [entries, total, kpis] = await Promise.all([
    prisma.timeEntry.findMany({
      where,
      take: pageSize,
      skip: (page - 1) * pageSize,
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        customer_id: true,
        va_id: true,
        duration_minutes: true,
        description: true,
        status: true,
        approved_at: true,
        payroll_locked: true,
        start_time: true,
        end_time: true,
        created_at: true,
      },
    }),
    prisma.timeEntry.count({ where }),
    prisma.timeEntry.groupBy({
      by: ["status"],
      _count: { id: true },
      _sum: { duration_minutes: true },
    }),
  ]);

  const countByStatus = Object.fromEntries(kpis.map((k) => [k.status, k._count.id]));
  const sumByStatus = Object.fromEntries(
    kpis.map((k) => [k.status, Number(k._sum.duration_minutes ?? 0)])
  );
  const totalApprovedHours = (sumByStatus["approved"] ?? 0) / 60;
  const totalPendingHours = (sumByStatus["pending"] ?? 0) / 60;
  const totalPages = Math.ceil(total / pageSize);

  const statuses = ["", "draft", "pending", "approved", "rejected"];

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Clock className="w-6 h-6 text-blue-500" />
          Time Tracking
        </h1>
        <a
          href="/api/exports?type=time_entries"
          className="px-3 py-1.5 text-sm bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 transition-colors flex items-center gap-1.5"
        >
          <FileText className="w-3.5 h-3.5" />
          Export CSV
        </a>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Total Entries"
          value={total}
        />
        <KpiCard
          label="Pending Approval"
          value={countByStatus["pending"] ?? 0}
          variant="warning"
          subtext={`${totalPendingHours.toFixed(1)} hrs`}
        />
        <KpiCard
          label="Approved Hours"
          value={`${totalApprovedHours.toFixed(1)} h`}
          variant="success"
          subtext={`${countByStatus["approved"] ?? 0} entries`}
        />
        <KpiCard
          label="Rejected"
          value={countByStatus["rejected"] ?? 0}
          variant="danger"
        />
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {statuses.map((s) => (
          <a
            key={s || "all"}
            href={s ? `?status=${s}` : "?"}
            className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
              filterStatus === s
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {s ? STATUS_LABELS[s] ?? s : "All"}
          </a>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-gray-600">ID</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600">Customer</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600">VA</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600">Duration</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600">Description</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600">Locked</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  No time entries found
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{e.id}</td>
                  <td className="px-4 py-3 text-gray-700">{e.customer_id}</td>
                  <td className="px-4 py-3 text-gray-500">{e.va_id ?? "—"}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">
                    {(Number(e.duration_minutes) / 60).toFixed(2)} h
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-xs truncate">
                    {e.description ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant(e.status)}>
                      {STATUS_LABELS[e.status] ?? e.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {e.payroll_locked ? (
                      <CheckCircle className="w-4 h-4 text-emerald-500 inline" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-gray-300 inline" />
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {e.created_at?.toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <a
                href={`?${filterStatus ? `status=${filterStatus}&` : ""}page=${page - 1}`}
                className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                ← Prev
              </a>
            )}
            {page < totalPages && (
              <a
                href={`?${filterStatus ? `status=${filterStatus}&` : ""}page=${page + 1}`}
                className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Next →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
