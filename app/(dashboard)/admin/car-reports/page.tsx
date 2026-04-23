import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FileBarChart2 } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

type CarMetrics = {
  tasks_completed: number;
  avg_turnaround_hours: number | null;
  sla_compliance_rate: number;
  revision_rate: number;
  hours_saved_estimate: number;
  effective_tier?: string;
};

type CarNarrative = {
  headline: string;
  ai_used?: boolean;
};

async function getReports() {
  const rows = await prisma.carReport.findMany({
    orderBy: [{ period_start: "desc" }, { customer_id: "asc" }],
    select: {
      id: true,
      customer_id: true,
      period_start: true,
      period_end: true,
      metrics_json: true,
      narrative_json: true,
      generated_at: true,
      generation_type: true,
      customer: { select: { name: true, effective_tier: true } },
    },
    take: 200,
  });
  return rows;
}

function pct(rate: number) {
  return `${(rate * 100).toFixed(1)}%`;
}

function monthLabel(d: Date) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default async function CarReportsPage() {
  await requireAuth();
  const reports = await getReports();

  // Group by period
  const byPeriod = new Map<string, typeof reports>();
  for (const r of reports) {
    const key = r.period_start.toISOString().slice(0, 7);
    if (!byPeriod.has(key)) byPeriod.set(key, []);
    byPeriod.get(key)!.push(r);
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileBarChart2 className="w-6 h-6 text-blue-500" />
          <h1 className="text-2xl font-bold text-gray-900">Client Advantage Reports</h1>
          <span className="text-xs text-gray-400 ml-1">Monthly per-client metrics + AI narratives</span>
        </div>
        <span className="text-sm text-gray-500">{reports.length} reports</span>
      </div>

      {reports.length === 0 ? (
        <div className="bg-white rounded-lg border shadow-sm p-12 text-center">
          <FileBarChart2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No reports yet. Trigger the CAR Builder from the admin triggers page.</p>
          <Link
            href="/admin/triggers"
            className="mt-3 inline-block text-sm text-blue-600 hover:underline"
          >
            Go to Triggers →
          </Link>
        </div>
      ) : (
        Array.from(byPeriod.entries()).map(([period, rows]) => (
          <div key={period} className="bg-white rounded-lg border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">
                {monthLabel(rows[0].period_start)}
              </h2>
              <span className="text-xs text-gray-400">{rows.length} clients</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {["Client", "Tier", "Tasks", "Avg Turnaround", "SLA", "Revision Rate", "Hours Saved", "Headline", "AI", "Generated"].map(
                    (h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => {
                  const m = r.metrics_json as unknown as CarMetrics;
                  const n = r.narrative_json as unknown as CarNarrative;
                  return (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 font-medium text-gray-900 max-w-[160px] truncate">
                        <Link href={`/admin/car-reports/${r.id}`} className="hover:text-blue-600">
                          {r.customer.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        {r.customer.effective_tier ? (
                          <span className="inline-block text-xs font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-700">
                            {r.customer.effective_tier}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
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
                            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              m.sla_compliance_rate >= 0.9
                                ? "bg-emerald-100 text-emerald-700"
                                : m.sla_compliance_rate >= 0.7
                                ? "bg-amber-100 text-amber-700"
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {pct(m.sla_compliance_rate)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {m?.revision_rate != null ? (
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              m.revision_rate < 0.1
                                ? "bg-emerald-100 text-emerald-700"
                                : m.revision_rate < 0.2
                                ? "bg-amber-100 text-amber-700"
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {pct(m.revision_rate)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">
                        {m?.hours_saved_estimate != null && m.hours_saved_estimate > 0
                          ? `${m.hours_saved_estimate}h`
                          : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 max-w-[220px]">
                        <p className="truncate text-xs italic">{n?.headline ?? "—"}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        {n?.ai_used ? (
                          <span className="text-xs text-blue-500 font-medium">AI</span>
                        ) : (
                          <span className="text-xs text-gray-400">Fallback</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-400 whitespace-nowrap">
                        {new Date(r.generated_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}