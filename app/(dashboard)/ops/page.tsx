import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { Cog, AlertTriangle, ExternalLink } from "lucide-react";
import Link from "next/link";
import { vaUuid } from "@/lib/uuid5";

export const dynamic = "force-dynamic";

export default async function OpsPage() {
  await requireAuth();

  const [jobStats, vaLoadStates, recentJobs, allVas] = await Promise.allSettled([
    Promise.all([
      prisma.jobBoardPost.count(),
      prisma.jobBoardPost.count({ where: { status: "posted" } }),
      prisma.jobBoardPost.count({ where: { status: "assigned" } }),
      prisma.jobBoardPost.count({ where: { status: "expired" } }),
    ]).then(([total, open, assigned, expired]) => ({ total, open, assigned, expired })),

    prisma.vaLoadState.findMany({
      orderBy: { updated_at: "desc" },
    }),

    prisma.jobBoardPost.findMany({
      where: { status: { in: ["posted", "assigned"] } },
      orderBy: { first_seen_at: "desc" },
      take: 50,
      select: {
        id: true, todo_title: true, status: true, first_seen_at: true,
        todo_url: true, claimed_by_slack_user_id: true, assigned_at: true,
        claimed_at: true, assigned_basecamp_person_id: true,
      },
    }),

    prisma.va.findMany({
      where: { active: true },
      select: { id: true, display_name: true },
    }),
  ]);

  const jobs = jobStats.status === "fulfilled" ? jobStats.value : { total: 0, open: 0, assigned: 0, expired: 0 };
  const loads = vaLoadStates.status === "fulfilled" ? vaLoadStates.value : [];
  const jobList = recentJobs.status === "fulfilled" ? recentJobs.value : [];
  const vas = allVas.status === "fulfilled" ? allVas.value : [];

  // Build UUID → {id, display_name} map for VA link resolution
  const vaByUuid = new Map<string, { id: number; display_name: string }>();
  for (const va of vas) {
    vaByUuid.set(vaUuid(va.id), { id: va.id, display_name: va.display_name });
  }

  const hardThrottled = loads.filter(v => v.throttle_level === "hard").length;
  const softThrottled = loads.filter(v => v.throttle_level === "soft").length;
  const burnoutCount = loads.filter(v => v.burnout_flag).length;

  function throttleVariant(level: string): "danger" | "warning" | "success" | "muted" {
    if (level === "hard") return "danger";
    if (level === "soft") return "warning";
    if (level === "normal") return "success";
    return "muted";
  }

  function jobStatusVariant(status: string): "warning" | "success" | "muted" | "danger" {
    if (status === "posted") return "warning";
    if (status === "assigned") return "success";
    if (status === "expired") return "danger";
    return "muted";
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Cog className="w-6 h-6 text-blue-500" />
          Operations
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Job board &amp; VA workload overview</p>
      </div>

      {/* Workload alert banner */}
      {(hardThrottled > 0 || softThrottled > 0 || burnoutCount > 0) && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm ${hardThrottled > 0 || burnoutCount > 0 ? "bg-red-50 border-red-200 text-red-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="font-semibold">Workload Alerts:</span>
          {hardThrottled > 0 && <Badge variant="danger">{hardThrottled} hard throttle</Badge>}
          {softThrottled > 0 && <Badge variant="warning">{softThrottled} soft throttle</Badge>}
          {burnoutCount > 0 && <Badge variant="danger">{burnoutCount} burnout risk</Badge>}
        </div>
      )}

      {/* Job KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Jobs" value={jobs.total} />
        <KpiCard label="Open" value={jobs.open} variant={jobs.open > 0 ? "warning" : "success"} />
        <KpiCard label="Assigned" value={jobs.assigned} variant="success" />
        <KpiCard label="Expired" value={jobs.expired} variant={jobs.expired > 0 ? "danger" : "muted"} />
      </div>

      {/* VA Load States */}
      {loads.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">VA Workload</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-2 text-xs text-gray-500 uppercase">VA ID</th>
                <th className="text-right px-4 py-2 text-xs text-gray-500 uppercase">Active Tasks</th>
                <th className="text-left px-4 py-2 text-xs text-gray-500 uppercase">Throttle</th>
                <th className="text-left px-4 py-2 text-xs text-gray-500 uppercase">Burnout</th>
                <th className="text-left px-4 py-2 text-xs text-gray-500 uppercase">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loads.map((v) => {
                const vaInfo = vaByUuid.get(v.va_id);
                return (
                  <tr key={v.va_id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      {vaInfo ? (
                        <Link
                          href={`/vas/${vaInfo.id}`}
                          className="text-sm font-medium text-blue-600 hover:underline"
                        >
                          {vaInfo.display_name}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs text-gray-400 truncate block max-w-[140px]" title={v.va_id}>
                          {v.va_id.slice(0, 8)}…
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium">{v.active_task_count}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={throttleVariant(v.throttle_level)}>{v.throttle_level}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      {v.burnout_flag
                        ? <Badge variant="danger">At risk</Badge>
                        : <span className="text-gray-400 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">
                      {v.updated_at.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Job Board */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">
            Active Job Board ({jobList.length})
          </h2>
        </div>
        {jobList.length === 0 ? (
          <p className="px-4 py-8 text-sm text-gray-400 text-center">No active jobs</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-2 text-xs text-gray-500 uppercase">Task</th>
                <th className="text-left px-4 py-2 text-xs text-gray-500 uppercase">Status</th>
                <th className="text-left px-4 py-2 text-xs text-gray-500 uppercase">Claimed By</th>
                <th className="text-left px-4 py-2 text-xs text-gray-500 uppercase">First Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {jobList.map((j) => (
                <tr key={j.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900 max-w-xs">
                    {j.todo_url ? (
                      <a href={j.todo_url} target="_blank" rel="noopener noreferrer"
                        className="hover:text-blue-600 flex items-center gap-1 truncate">
                        <span className="truncate">{j.todo_title || "Untitled"}</span>
                        <ExternalLink className="w-3 h-3 text-gray-400 shrink-0" />
                      </a>
                    ) : (
                      <span className="truncate">{j.todo_title || "Untitled"}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant={jobStatusVariant(j.status)}>{j.status}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">
                    {j.claimed_by_slack_user_id ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">
                    {j.first_seen_at.toLocaleDateString()}
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
