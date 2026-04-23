import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TrendingUp, Users, Building2, FileText } from "lucide-react";
import Link from "next/link";
import { ReportRowActions } from "./row-actions";

export const dynamic = "force-dynamic";

type Narrative = {
  headline: string;
  wins?: string[];
  trend_notes?: string;
  next_month_focus?: string;
  ai_used?: boolean;
};

type ClientMetrics = {
  customer_name: string;
  tasks_completed: number;
  avg_turnaround_hours: number | null;
  first_pass_quality_rate: number;
  praise_count: number;
  revisions_count: number;
  payroll_waste_avoided?: { amount_usd: number };
};

type VaMetrics = {
  va_name: string;
  tasks_completed: number;
  avg_turnaround_hours: number | null;
  revision_rate: number;
  praise_count: number;
  stability_score: number;
  throttle_events: number;
};

async function getReports() {
  const rows = await prisma.advantageReport.findMany({
    orderBy: [{ period_start: "desc" }, { report_type: "asc" }],
    select: {
      id: true,
      report_type: true,
      subject_id: true,
      period_start: true,
      period_end: true,
      metrics_json: true,
      narrative_json: true,
      status: true,
      generation_type: true,
      created_at: true,
    },
    take: 300,
  });
  return rows;
}

function periodLabel(d: Date) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function pct(r: number) {
  return `${(r * 100).toFixed(1)}%`;
}

export default async function AdvantageReportsPage() {
  await requireAuth();
  const reports = await getReports();

  const clientReports = reports.filter((r) => r.report_type === "client_monthly");
  const vaReports = reports.filter((r) => r.report_type === "va_monthly");

  // Group both by period
  const byPeriod = new Map<string, { client: typeof reports; va: typeof reports }>();
  for (const r of reports) {
    const key = r.period_start.toISOString().slice(0, 7);
    if (!byPeriod.has(key)) byPeriod.set(key, { client: [], va: [] });
    const group = byPeriod.get(key)!;
    if (r.report_type === "client_monthly") group.client.push(r);
    else group.va.push(r);
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-blue-500" />
          <h1 className="text-2xl font-bold text-gray-900">Advantage Reports</h1>
          <span className="text-xs text-gray-400 ml-1">Monthly branded reports — clients & VAs</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span className="flex items-center gap-1">
            <Building2 className="w-4 h-4" />
            {clientReports.length} client
          </span>
          <span className="flex items-center gap-1">
            <Users className="w-4 h-4" />
            {vaReports.length} VA
          </span>
        </div>
      </div>

      {reports.length === 0 ? (
        <div className="bg-white rounded-lg border shadow-sm p-12 text-center">
          <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No advantage reports yet. Trigger the Advantage Report Builder.</p>
          <Link href="/admin/triggers" className="mt-3 inline-block text-sm text-blue-600 hover:underline">
            Go to Triggers →
          </Link>
        </div>
      ) : (
        Array.from(byPeriod.entries()).map(([period, { client: cRows, va: vRows }]) => (
          <div key={period} className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide px-1">
              {periodLabel(cRows[0]?.period_start ?? vRows[0]?.period_start ?? new Date())}
            </h2>

            {/* Client reports table */}
            {cRows.length > 0 && (
              <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b bg-gray-50 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-blue-500" />
                  <span className="text-sm font-medium text-gray-700">Client Reports ({cRows.length})</span>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      {["Client", "Tasks", "Turnaround", "FPQ Rate", "Praise", "Revisions", "Payroll Avoided", "Headline", "AI", "Status", ""].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {cRows.map((r) => {
                      const m = r.metrics_json as unknown as ClientMetrics;
                      const n = r.narrative_json as unknown as Narrative;
                      return (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2.5 font-medium text-gray-900 max-w-[150px] truncate">
                            <Link href={`/admin/advantage-reports/${r.id}`} className="hover:text-blue-600">
                              {m?.customer_name ?? "—"}
                            </Link>
                          </td>
                          <td className="px-3 py-2.5 text-gray-600">{m?.tasks_completed ?? "—"}</td>
                          <td className="px-3 py-2.5 text-gray-600">
                            {m?.avg_turnaround_hours != null ? `${Number(m.avg_turnaround_hours).toFixed(1)}h` : "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            {m?.first_pass_quality_rate != null ? (
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                m.first_pass_quality_rate >= 0.9 ? "bg-emerald-100 text-emerald-700"
                                : m.first_pass_quality_rate >= 0.75 ? "bg-amber-100 text-amber-700"
                                : "bg-red-100 text-red-700"
                              }`}>
                                {pct(m.first_pass_quality_rate)}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-gray-600">{m?.praise_count ?? "—"}</td>
                          <td className="px-3 py-2.5">
                            {(m?.revisions_count ?? 0) > 0 ? (
                              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                {m.revisions_count}
                              </span>
                            ) : (
                              <span className="text-xs text-emerald-600">0</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-gray-600 text-xs">
                            {m?.payroll_waste_avoided?.amount_usd
                              ? `$${m.payroll_waste_avoided.amount_usd.toLocaleString()}`
                              : "—"}
                          </td>
                          <td className="px-3 py-2.5 max-w-[200px]">
                            <p className="text-xs italic text-gray-500 truncate">{n?.headline ?? "—"}</p>
                          </td>
                          <td className="px-3 py-2.5">
                            {n?.ai_used ? (
                              <span className="text-xs font-medium text-blue-500">AI</span>
                            ) : (
                              <span className="text-xs text-gray-400">FB</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              r.status === "sent"     ? "bg-emerald-100 text-emerald-700"
                              : r.status === "rendered" ? "bg-amber-100 text-amber-700"
                              : r.status === "failed"   ? "bg-red-100 text-red-700"
                              : "bg-gray-100 text-gray-600"
                            }`}>
                              {r.status}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            {r.status !== "sent" && (
                              <ReportRowActions reportId={r.id} status={r.status} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* VA reports table */}
            {vRows.length > 0 && (
              <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b bg-gray-50 flex items-center gap-2">
                  <Users className="w-4 h-4 text-purple-500" />
                  <span className="text-sm font-medium text-gray-700">VA Reports ({vRows.length})</span>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      {["VA", "Tasks", "Turnaround", "Revision Rate", "Praise", "Stability", "Throttle Days", "Headline", "AI", "Status", ""].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {vRows.map((r) => {
                      const m = r.metrics_json as unknown as VaMetrics;
                      const n = r.narrative_json as unknown as Narrative;
                      return (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2.5 font-medium text-gray-900 max-w-[140px] truncate">
                            <Link href={`/admin/advantage-reports/${r.id}`} className="hover:text-blue-600">
                              {m?.va_name ?? "—"}
                            </Link>
                          </td>
                          <td className="px-3 py-2.5 text-gray-600">{m?.tasks_completed ?? "—"}</td>
                          <td className="px-3 py-2.5 text-gray-600">
                            {m?.avg_turnaround_hours != null ? `${Number(m.avg_turnaround_hours).toFixed(1)}h` : "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            {m?.revision_rate != null ? (
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                m.revision_rate < 0.05 ? "bg-emerald-100 text-emerald-700"
                                : m.revision_rate < 0.15 ? "bg-amber-100 text-amber-700"
                                : "bg-red-100 text-red-700"
                              }`}>
                                {pct(m.revision_rate)}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-gray-600">{m?.praise_count ?? "—"}</td>
                          <td className="px-3 py-2.5">
                            {m?.stability_score != null ? (
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                m.stability_score >= 80 ? "bg-emerald-100 text-emerald-700"
                                : m.stability_score >= 60 ? "bg-amber-100 text-amber-700"
                                : "bg-red-100 text-red-700"
                              }`}>
                                {m.stability_score}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-gray-600">
                            {(m?.throttle_events ?? 0) > 0 ? (
                              <span className="text-xs font-medium text-amber-600">{m.throttle_events}d</span>
                            ) : (
                              <span className="text-xs text-emerald-600">0</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 max-w-[200px]">
                            <p className="text-xs italic text-gray-500 truncate">{n?.headline ?? "—"}</p>
                          </td>
                          <td className="px-3 py-2.5">
                            {n?.ai_used ? (
                              <span className="text-xs font-medium text-blue-500">AI</span>
                            ) : (
                              <span className="text-xs text-gray-400">FB</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              r.status === "sent"     ? "bg-emerald-100 text-emerald-700"
                              : r.status === "rendered" ? "bg-amber-100 text-amber-700"
                              : r.status === "failed"   ? "bg-red-100 text-red-700"
                              : "bg-gray-100 text-gray-600"
                            }`}>
                              {r.status}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            {r.status !== "sent" && (
                              <ReportRowActions reportId={r.id} status={r.status} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}