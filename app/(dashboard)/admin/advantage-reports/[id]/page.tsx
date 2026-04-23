/**
 * app/(dashboard)/admin/advantage-reports/[id]/page.tsx
 *
 * Individual AdvantageReport detail page.
 * Shows narrative, key metrics, and approve/retract actions.
 * The advantage-report-sender links here in its Slack Block Kit messages.
 */
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { TrendingUp, ArrowLeft, CheckCircle, RotateCcw, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ReportActionButton } from "./action-button";

export const dynamic = "force-dynamic";

type Narrative = {
  headline?: string;
  wins?: string[];
  trend_notes?: string;
  next_month_focus?: string;
  summary?: string;
  positioning_line?: string;
  ai_used?: boolean;
};

type ClientMetrics = {
  customer_name?: string;
  effective_tier?: string;
  tasks_completed?: number;
  avg_turnaround_hours?: number | null;
  first_pass_quality_rate?: number | null;
  client_health_score?: number | null;
  praise_count?: number;
  revisions_count?: number;
  payroll_waste_avoided?: { amount_usd?: number };
};

type VaMetrics = {
  va_name?: string;
  tasks_completed?: number;
  avg_turnaround_hours?: number | null;
  revision_rate?: number | null;
  praise_count?: number;
  stability_score?: number | null;
  throttle_events?: number;
};

function pct(r: number) {
  return `${(r * 100).toFixed(1)}%`;
}

function fmt(n: number | null | undefined, suffix = "") {
  if (n == null) return "—";
  return `${Number(n).toFixed(1)}${suffix}`;
}

const STATUS_STYLES: Record<string, string> = {
  draft:    "bg-gray-100 text-gray-600",
  rendered: "bg-amber-100 text-amber-700",
  sent:     "bg-emerald-100 text-emerald-700",
  failed:   "bg-red-100 text-red-700",
};

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const report = await prisma.advantageReport.findUnique({ where: { id } });
  if (!report) notFound();

  const metrics   = (report.metrics_json   ?? {}) as ClientMetrics & VaMetrics;
  const narrative = (report.narrative_json ?? {}) as Narrative;
  const isClient  = report.report_type === "client_monthly";
  const subjectName = isClient
    ? (metrics.customer_name ?? "Unknown Client")
    : (metrics.va_name ?? "Unknown VA");

  const periodLabel = new Date(report.period_start).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const statusCls = STATUS_STYLES[report.status] ?? "bg-gray-100 text-gray-500";

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Back link */}
      <Link
        href="/admin/advantage-reports"
        className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Advantage Reports
      </Link>

      {/* Header */}
      <div className="bg-white rounded-lg border shadow-sm p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 border border-blue-100 rounded-lg">
              <TrendingUp className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">
                {subjectName} — {periodLabel}
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">
                {isClient ? "Client Monthly Report" : "VA Monthly Report"} · {report.generation_type}
              </p>
            </div>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${statusCls}`}>
            {report.status}
          </span>
        </div>

        {/* Action buttons */}
        {report.status !== "sent" && (
          <div className="flex items-center gap-2 pt-1">
            {report.status !== "rendered" && (
              <ReportActionButton
                reportId={report.id}
                action="render"
                label="Approve & Render"
                icon="check"
                variant="primary"
              />
            )}
            {report.status === "rendered" && (
              <>
                <span className="text-xs text-amber-600 font-medium flex items-center gap-1">
                  <Send className="w-3.5 h-3.5" /> Queued to send on next sender run
                </span>
                <ReportActionButton
                  reportId={report.id}
                  action="retract"
                  label="Retract"
                  icon="undo"
                  variant="ghost"
                />
              </>
            )}
          </div>
        )}
        {report.status === "sent" && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium pt-1">
            <CheckCircle className="w-3.5 h-3.5" /> Delivered via Slack
          </div>
        )}
      </div>

      {/* Narrative */}
      {narrative.headline && (
        <div className="bg-white rounded-lg border shadow-sm p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Narrative</h2>
          <p className="text-sm italic text-gray-700">{narrative.headline}</p>
          {narrative.wins && narrative.wins.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Wins</p>
              <ul className="space-y-1">
                {narrative.wins.map((w, i) => (
                  <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                    <span className="text-emerald-500 mt-0.5">•</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {narrative.trend_notes && (
            <p className="text-xs text-gray-500 border-t pt-2">{narrative.trend_notes}</p>
          )}
          {narrative.next_month_focus && (
            <p className="text-xs text-blue-600">
              <span className="font-semibold">Next month:</span> {narrative.next_month_focus}
            </p>
          )}
          {narrative.positioning_line && (
            <p className="text-xs italic text-gray-400">{narrative.positioning_line}</p>
          )}
          {narrative.ai_used && (
            <span className="inline-block text-xs font-medium text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">
              AI generated
            </span>
          )}
        </div>
      )}

      {/* Metrics */}
      <div className="bg-white rounded-lg border shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Metrics</h2>
        {isClient ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
            <Metric label="Tasks Completed" value={String(metrics.tasks_completed ?? "—")} />
            <Metric label="Avg Turnaround" value={fmt(metrics.avg_turnaround_hours, "h")} />
            <Metric label="First-Pass Quality" value={metrics.first_pass_quality_rate != null ? pct(metrics.first_pass_quality_rate) : "—"} />
            <Metric label="Client Health Score" value={String(metrics.client_health_score ?? "—")} />
            <Metric label="Praise Count" value={String(metrics.praise_count ?? "—")} />
            <Metric label="Revisions" value={String(metrics.revisions_count ?? "—")} />
            {(metrics.payroll_waste_avoided?.amount_usd ?? 0) > 0 && (
              <Metric
                label="Payroll Waste Avoided"
                value={`$${(metrics.payroll_waste_avoided!.amount_usd!).toLocaleString()}`}
                highlight
              />
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
            <Metric label="Tasks Completed" value={String(metrics.tasks_completed ?? "—")} />
            <Metric label="Avg Turnaround" value={fmt(metrics.avg_turnaround_hours, "h")} />
            <Metric label="Revision Rate" value={metrics.revision_rate != null ? pct(metrics.revision_rate) : "—"} />
            <Metric label="Praise Count" value={String(metrics.praise_count ?? "—")} />
            <Metric label="Stability Score" value={String(metrics.stability_score ?? "—")} />
            <Metric label="Throttle Events" value={String(metrics.throttle_events ?? "—")} />
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="text-xs text-gray-400 space-y-0.5 px-1">
        <p>Report ID: <span className="font-mono">{report.id}</span></p>
        <p>Period: {new Date(report.period_start).toLocaleDateString()} – {new Date(report.period_end).toLocaleDateString()}</p>
        <p>Created: {new Date(report.created_at).toLocaleString()}</p>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`p-3 rounded-lg border ${highlight ? "border-emerald-200 bg-emerald-50" : "border-gray-100 bg-gray-50"}`}>
      <p className="text-gray-400 uppercase tracking-wide font-semibold mb-0.5 text-[10px]">{label}</p>
      <p className={`font-bold text-sm ${highlight ? "text-emerald-700" : "text-gray-800"}`}>{value}</p>
    </div>
  );
}