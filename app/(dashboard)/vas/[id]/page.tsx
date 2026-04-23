import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import {
  Users, Clock, AlertTriangle, TrendingDown, ArrowLeft, Activity,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { vaUuid } from "@/lib/uuid5";
import { RebuildSnapshotButton } from "./rebuild-snapshot-button";

export const dynamic = "force-dynamic";

type SnapMetrics = {
  tasks_completed?: number;
  avg_turnaround_hours?: number;
  revision_rate?: number;
  praise_count?: number;
  stability_score?: number;
};

export default async function VaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;
  const vaId = parseInt(id, 10);
  if (isNaN(vaId)) notFound();

  const va = await prisma.va.findUnique({ where: { id: vaId } });
  if (!va) notFound();

  const vaUid = vaUuid(va.id);

  const [loadState, openTodos, snapshots, scoreHistory] = await Promise.all([
    prisma.vaLoadState.findUnique({ where: { va_id: vaUid } }),
    va.basecamp_person_id
      ? prisma.basecampTodo.findMany({
          where: { assignee_id: String(va.basecamp_person_id), completed: false },
          orderBy: [{ risk_overdue: "desc" }, { due_on: "asc" }],
          take: 25,
          select: {
            id: true, title: true, due_on: true,
            risk_overdue: true, risk_due_soon: true,
            workflow_state: true, project_name: true,
          },
        })
      : Promise.resolve([]),
    prisma.vaPerformanceSnapshot.findMany({
      where: { va_id: vaUid },
      orderBy: { period_start: "desc" },
      take: 6,
      select: { id: true, period_start: true, period_end: true, metrics_json: true },
    }),
    prisma.scoreDaily.findMany({
      where: { person_id: va.id },
      orderBy: { day: "desc" },
      take: 14,
      select: { id: true, day: true, score_type: true, score_value: true, band: true },
    }),
  ]);

  const throttle = loadState?.throttle_level ?? "normal";
  const burnout = loadState?.burnout_flag ?? false;
  const reasons = (loadState?.reasons_json as string[] | null) ?? [];
  const riskCount = openTodos.filter((t) => t.risk_overdue || t.risk_due_soon).length;

  function relVariant(score: number | null): "success" | "warning" | "danger" | "muted" {
    if (score == null) return "muted";
    if (score >= 80) return "success";
    if (score >= 60) return "warning";
    return "danger";
  }

  const initials = va.display_name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Back */}
      <Link href="/vas" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="w-3.5 h-3.5" /> All team
      </Link>

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-lg shrink-0">
          {initials}
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-500" />
            {va.display_name}
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-sm text-gray-500">{va.email ?? "—"}</span>
            {va.slack_user_id && <Badge variant="info">Slack</Badge>}
            {va.basecamp_person_id && <Badge variant="success">Basecamp</Badge>}
            <Badge variant={va.active ? "success" : "muted"}>
              {va.active ? "Active" : "Inactive"}
            </Badge>
            {burnout && <Badge variant="danger">Burnout Risk</Badge>}
            {throttle !== "normal" && (
              <Badge variant="warning">Throttled: {throttle}</Badge>
            )}
          </div>
        </div>
        <div className="shrink-0">
          <RebuildSnapshotButton vaId={va.id} />
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Reliability"
          value={va.reliability_score != null ? `${va.reliability_score}%` : "—"}
          variant={relVariant(va.reliability_score)}
        />
        <KpiCard
          label="Capacity Index"
          value={va.capacity_index ?? "—"}
          variant="default"
        />
        <KpiCard
          label="Active Tasks"
          value={loadState?.active_task_count ?? openTodos.length}
          variant={burnout ? "danger" : throttle !== "normal" ? "warning" : "default"}
        />
        <KpiCard
          label="At Risk"
          value={riskCount}
          variant={riskCount === 0 ? "success" : "danger"}
        />
      </div>

      {/* Burnout / throttle alert */}
      {(burnout || throttle !== "normal" || reasons.length > 0) && (
        <div
          className={`rounded-lg border p-4 flex gap-3 ${
            burnout ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"
          }`}
        >
          {burnout ? (
            <TrendingDown className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          )}
          <div>
            <p className="text-sm font-medium text-gray-800">
              {burnout ? "Burnout risk detected" : `Throttle level: ${throttle}`}
            </p>
            {reasons.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {reasons.slice(0, 5).map((r, i) => (
                  <li key={i} className="text-xs text-gray-600">
                    • {r}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Open todos */}
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b bg-gray-50 flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium text-gray-700">
            Open Tasks ({openTodos.length})
          </span>
        </div>
        {openTodos.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-400 text-sm">No open tasks</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {["Task", "Client", "Due", "State"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {openTodos.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2.5 max-w-[260px]">
                    <Link
                      href={`/todos/${t.id}`}
                      className="text-blue-600 hover:underline text-xs line-clamp-2"
                    >
                      {t.title ?? "—"}
                    </Link>
                    <div className="flex gap-1 mt-0.5">
                      {t.risk_overdue && (
                        <span className="text-xs text-red-600 flex items-center gap-0.5">
                          <AlertTriangle className="w-3 h-3" /> Overdue
                        </span>
                      )}
                      {t.risk_due_soon && !t.risk_overdue && (
                        <span className="text-xs text-amber-600">Due soon</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-500 truncate max-w-[120px]">
                    {t.project_name ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                    {t.due_on ? (
                      <span
                        className={
                          t.risk_overdue
                            ? "text-red-600 font-medium"
                            : t.risk_due_soon
                            ? "text-amber-600"
                            : "text-gray-600"
                        }
                      >
                        {format(new Date(t.due_on), "MMM d")}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {t.workflow_state && (
                      <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                        {t.workflow_state}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Performance snapshots */}
      {snapshots.length > 0 && (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-gray-50 flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-purple-500" />
            <span className="text-sm font-medium text-gray-700">Performance Snapshots</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {["Period", "Tasks", "Turnaround", "Revision Rate", "Praise", "Stability"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-xs font-semibold text-gray-500"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {snapshots.map((s) => {
                const m = s.metrics_json as unknown as SnapMetrics;
                return (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap text-gray-700">
                      {format(new Date(s.period_start), "MMM d")} —{" "}
                      {format(new Date(s.period_end), "MMM d, yyyy")}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{m?.tasks_completed ?? "—"}</td>
                    <td className="px-3 py-2.5 text-gray-600">
                      {m?.avg_turnaround_hours != null
                        ? `${Number(m.avg_turnaround_hours).toFixed(1)}h`
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {m?.revision_rate != null ? (
                        <span
                          className={`text-xs font-medium ${
                            m.revision_rate < 0.05
                              ? "text-emerald-600"
                              : m.revision_rate < 0.15
                              ? "text-amber-600"
                              : "text-red-600"
                          }`}
                        >
                          {Math.round(m.revision_rate * 100)}%
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{m?.praise_count ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      {m?.stability_score != null ? (
                        <span
                          className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                            m.stability_score >= 80
                              ? "bg-emerald-100 text-emerald-700"
                              : m.stability_score >= 60
                              ? "bg-amber-100 text-amber-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {m.stability_score}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Score history */}
      {scoreHistory.length > 0 && (
        <div className="bg-white rounded-lg border shadow-sm">
          <div className="px-4 py-2.5 border-b bg-gray-50">
            <span className="text-sm font-medium text-gray-700">
              Score History (last 14 days)
            </span>
          </div>
          <div className="px-4 py-3 flex flex-wrap gap-2">
            {scoreHistory.map((s) => (
              <div
                key={s.id}
                className="flex flex-col items-center bg-gray-50 rounded px-2 py-1.5 text-center min-w-[56px]"
              >
                <span className="text-xs text-gray-400">{format(new Date(s.day), "M/d")}</span>
                <span className="text-xs text-gray-400 truncate max-w-[60px]">{s.score_type}</span>
                <span
                  className={`text-sm font-bold ${
                    Number(s.score_value) >= 80
                      ? "text-emerald-600"
                      : Number(s.score_value) >= 60
                      ? "text-amber-600"
                      : "text-red-600"
                  }`}
                >
                  {Math.round(Number(s.score_value))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Last scored */}
      {va.last_scored_at && (
        <p className="text-xs text-gray-400 text-right">
          Last scored {format(new Date(va.last_scored_at), "MMM d, yyyy 'at' h:mm a")}
        </p>
      )}
    </div>
  );
}