import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import {
  Building2, AlertTriangle, Clock, CheckCircle,
  FileBarChart2, BookOpen, ArrowLeft,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

type CarMetrics = {
  tasks_completed?: number;
  avg_turnaround_hours?: number;
  sla_compliance_rate?: number;
  hours_saved_estimate?: number;
};
type CarNarrative = { headline?: string };

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;
  const customerId = parseInt(id, 10);
  if (isNaN(customerId)) notFound();

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) notFound();

  const [openTodos, carReports, playbook, scoreHistory] = await Promise.all([
    customer.basecamp_project_id
      ? prisma.basecampTodo.findMany({
          where: { basecamp_project_id: customer.basecamp_project_id, completed: false },
          orderBy: [{ due_on: "asc" }, { created_at: "desc" }],
          take: 25,
          select: {
            id: true, title: true, assignee_name: true,
            due_on: true, workflow_state: true,
            risk_overdue: true, risk_due_soon: true,
          },
        })
      : Promise.resolve([]),
    prisma.carReport.findMany({
      where: { customer_id: customerId },
      orderBy: { period_start: "desc" },
      take: 6,
      select: {
        id: true, period_start: true, period_end: true,
        metrics_json: true, narrative_json: true,
      },
    }),
    prisma.clientPlaybook.findUnique({ where: { client_id: String(customerId) } }),
    prisma.scoreDaily.findMany({
      where: { customer_id: customerId },
      orderBy: { day: "desc" },
      take: 14,
      select: { id: true, day: true, score_type: true, score_value: true, band: true },
    }),
  ]);

  const riskCount = openTodos.filter((t) => t.risk_overdue || t.risk_due_soon).length;
  const topRules = (playbook?.top_rules as string[] | null) ?? [];

  function tierVariant(tier: string | null): "success" | "default" | "warning" | "muted" {
    if (tier === "A") return "success";
    if (tier === "B") return "default";
    if (tier === "C") return "warning";
    return "muted";
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Back */}
      <Link href="/customers" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="w-3.5 h-3.5" /> All clients
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Building2 className="w-6 h-6 text-blue-500" />
            {customer.name}
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant={tierVariant(customer.effective_tier)}>
              Tier {customer.effective_tier ?? "—"}
            </Badge>
            <Badge variant={customer.active ? "success" : "muted"}>
              {customer.active ? "Active" : "Inactive"}
            </Badge>
            {customer.basecamp_project_id && (
              <span className="text-xs text-gray-400">BC #{customer.basecamp_project_id}</span>
            )}
            {customer.slack_channel_id && (
              <Badge variant="info">Slack</Badge>
            )}
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Health Score"
          value={customer.client_health_score != null ? `${customer.client_health_score}%` : "—"}
          variant={
            customer.client_health_score == null ? "muted"
            : customer.client_health_score >= 80 ? "success"
            : customer.client_health_score >= 60 ? "warning"
            : "danger"
          }
        />
        <KpiCard
          label="Open Tasks"
          value={openTodos.length}
          variant={openTodos.length === 0 ? "success" : "default"}
        />
        <KpiCard
          label="At Risk"
          value={riskCount}
          variant={riskCount === 0 ? "success" : "danger"}
        />
        <KpiCard
          label="Bucket Balance"
          value={customer.bucket_balance != null ? `${Number(customer.bucket_balance).toFixed(1)}h` : "—"}
          variant="default"
        />
      </div>

      {/* Open todos */}
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b bg-gray-50 flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium text-gray-700">
            Open Tasks ({openTodos.length})
          </span>
        </div>
        {openTodos.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-400 text-sm flex items-center justify-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" /> No open tasks
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {["Task", "Assignee", "Due", "State", "Risk"].map((h) => (
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
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">
                    {t.assignee_name ?? (
                      <span className="text-gray-400 italic">Unassigned</span>
                    )}
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
                  <td className="px-3 py-2.5">
                    {t.risk_overdue ? (
                      <span className="text-xs text-red-600 font-medium flex items-center gap-0.5">
                        <AlertTriangle className="w-3 h-3" /> Overdue
                      </span>
                    ) : t.risk_due_soon ? (
                      <span className="text-xs text-amber-600">Due soon</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Playbook rules */}
      {topRules.length > 0 && (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-gray-50 flex items-center gap-1.5">
            <BookOpen className="w-4 h-4 text-purple-500" />
            <span className="text-sm font-medium text-gray-700">Playbook Rules</span>
            {playbook?.last_built_at && (
              <span className="ml-auto text-xs text-gray-400">
                Built {format(new Date(playbook.last_built_at), "MMM d")}
              </span>
            )}
          </div>
          <ul className="divide-y divide-gray-100">
            {topRules.slice(0, 8).map((rule, i) => (
              <li key={i} className="px-4 py-2 text-sm text-gray-700 flex items-start gap-2">
                <span className="text-gray-400 text-xs mt-0.5 shrink-0">{i + 1}.</span>
                {rule}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* CAR reports */}
      {carReports.length > 0 && (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-gray-50 flex items-center gap-1.5">
            <FileBarChart2 className="w-4 h-4 text-blue-500" />
            <span className="text-sm font-medium text-gray-700">CAR Reports</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {["Period", "Tasks", "Turnaround", "SLA", "Hours Saved", "Headline"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {carReports.map((r) => {
                const m = r.metrics_json as unknown as CarMetrics;
                const n = r.narrative_json as unknown as CarNarrative;
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap text-gray-700">
                      {format(new Date(r.period_start), "MMM d")} —{" "}
                      {format(new Date(r.period_end), "MMM d, yyyy")}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{m?.tasks_completed ?? "—"}</td>
                    <td className="px-3 py-2.5 text-gray-600">
                      {m?.avg_turnaround_hours != null
                        ? `${Number(m.avg_turnaround_hours).toFixed(1)}h`
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {m?.sla_compliance_rate != null ? (
                        <span
                          className={`text-xs font-medium ${
                            m.sla_compliance_rate >= 0.9
                              ? "text-emerald-600"
                              : m.sla_compliance_rate >= 0.75
                              ? "text-amber-600"
                              : "text-red-600"
                          }`}
                        >
                          {Math.round(m.sla_compliance_rate * 100)}%
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">
                      {m?.hours_saved_estimate != null
                        ? `${Number(m.hours_saved_estimate).toFixed(1)}h`
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 max-w-[200px]">
                      <p className="text-xs italic text-gray-500 truncate">{n?.headline ?? "—"}</p>
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
            <span className="text-sm font-medium text-gray-700">Score History</span>
          </div>
          <div className="px-4 py-3 flex flex-wrap gap-2">
            {scoreHistory.map((s) => (
              <div
                key={s.id}
                className="flex flex-col items-center bg-gray-50 rounded px-2 py-1.5 text-center min-w-[56px]"
              >
                <span className="text-xs text-gray-400">{format(new Date(s.day), "M/d")}</span>
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
                {s.band && <span className="text-xs text-gray-400">{s.band}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}