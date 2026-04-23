import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { FileBarChart2, ArrowLeft, Building2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

type CarMetrics = {
  tasks_completed?: number;
  avg_turnaround_hours?: number;
  sla_compliance_rate?: number;
  revision_rate?: number;
  hours_saved_estimate?: number;
  effective_tier?: string;
  total_tasks_created?: number;
  late_tasks?: number;
  praise_count?: number;
  escalation_count?: number;
  avg_response_time_hours?: number;
};

type CarNarrative = {
  headline?: string;
  summary?: string;
  wins?: string[];
  concerns?: string[];
  next_month_focus?: string;
  ai_used?: boolean;
};

export default async function CarReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;
  const reportId = parseInt(id, 10);
  if (isNaN(reportId)) notFound();

  const report = await prisma.carReport.findUnique({
    where: { id: reportId },
    include: { customer: { select: { id: true, name: true, effective_tier: true } } },
  });
  if (!report) notFound();

  const m = report.metrics_json as unknown as CarMetrics;
  const n = report.narrative_json as unknown as CarNarrative;

  function pct(rate: number | undefined) {
    if (rate == null) return "—";
    return `${(rate * 100).toFixed(1)}%`;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Back */}
      <Link
        href="/admin/car-reports"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> All CAR Reports
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileBarChart2 className="w-6 h-6 text-blue-500" />
            CAR Report
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Link
              href={`/customers/${report.customer.id}`}
              className="flex items-center gap-1 text-blue-600 hover:underline text-sm font-medium"
            >
              <Building2 className="w-3.5 h-3.5" />
              {report.customer.name}
            </Link>
            {report.customer.effective_tier && (
              <Badge variant={
                report.customer.effective_tier === "A" ? "success"
                : report.customer.effective_tier === "B" ? "default"
                : "warning"
              }>
                Tier {report.customer.effective_tier}
              </Badge>
            )}
            <span className="text-sm text-gray-500">
              {format(new Date(report.period_start), "MMMM d")} —{" "}
              {format(new Date(report.period_end), "MMMM d, yyyy")}
            </span>
            <Badge variant={report.generation_type === "ai" ? "info" : "muted"}>
              {report.generation_type === "ai" ? "AI" : n?.ai_used ? "AI" : "Fallback"}
            </Badge>
          </div>
        </div>
        <p className="text-xs text-gray-400 whitespace-nowrap">
          Generated {format(new Date(report.generated_at), "MMM d, yyyy")}
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Tasks Completed" value={m?.tasks_completed ?? "—"} variant="success" />
        <KpiCard
          label="Avg Turnaround"
          value={m?.avg_turnaround_hours != null ? `${Number(m.avg_turnaround_hours).toFixed(1)}h` : "—"}
          variant="default"
        />
        <KpiCard
          label="SLA Compliance"
          value={pct(m?.sla_compliance_rate)}
          variant={
            m?.sla_compliance_rate == null ? "muted"
            : m.sla_compliance_rate >= 0.9 ? "success"
            : m.sla_compliance_rate >= 0.7 ? "warning"
            : "danger"
          }
        />
        <KpiCard
          label="Hours Saved"
          value={m?.hours_saved_estimate != null ? `${m.hours_saved_estimate}h` : "—"}
          variant="info"
        />
      </div>

      {/* Secondary metrics */}
      {(m?.revision_rate != null || m?.praise_count != null || m?.late_tasks != null || m?.escalation_count != null) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {m?.revision_rate != null && (
            <KpiCard
              label="Revision Rate"
              value={pct(m.revision_rate)}
              variant={m.revision_rate < 0.1 ? "success" : m.revision_rate < 0.2 ? "warning" : "danger"}
            />
          )}
          {m?.praise_count != null && (
            <KpiCard label="Praise" value={m.praise_count} variant="success" />
          )}
          {m?.late_tasks != null && (
            <KpiCard
              label="Late Tasks"
              value={m.late_tasks}
              variant={m.late_tasks === 0 ? "success" : "warning"}
            />
          )}
          {m?.escalation_count != null && (
            <KpiCard
              label="Escalations"
              value={m.escalation_count}
              variant={m.escalation_count === 0 ? "success" : "danger"}
            />
          )}
        </div>
      )}

      {/* Narrative */}
      {n?.headline && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
          <p className="text-base font-semibold text-blue-900 italic">{n.headline}</p>
        </div>
      )}

      {n?.summary && (
        <div className="bg-white rounded-lg border shadow-sm px-4 py-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Summary</h2>
          <p className="text-sm text-gray-600 leading-relaxed">{n.summary}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {n?.wins && n.wins.length > 0 && (
          <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b bg-emerald-50">
              <span className="text-sm font-medium text-emerald-800">Wins</span>
            </div>
            <ul className="divide-y divide-gray-100">
              {n.wins.map((w, i) => (
                <li key={i} className="px-4 py-2.5 text-sm text-gray-700 flex gap-2 items-start">
                  <span className="text-emerald-500 mt-0.5">+</span>
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}

        {n?.concerns && n.concerns.length > 0 && (
          <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b bg-amber-50">
              <span className="text-sm font-medium text-amber-800">Concerns</span>
            </div>
            <ul className="divide-y divide-gray-100">
              {n.concerns.map((c, i) => (
                <li key={i} className="px-4 py-2.5 text-sm text-gray-700 flex gap-2 items-start">
                  <span className="text-amber-500 mt-0.5">!</span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {n?.next_month_focus && (
        <div className="bg-white rounded-lg border shadow-sm px-4 py-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Next Month Focus</h2>
          <p className="text-sm text-gray-600">{n.next_month_focus}</p>
        </div>
      )}
    </div>
  );
}