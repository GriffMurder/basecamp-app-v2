import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, ArrowLeft, BookOpen, CheckCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) notFound();

  const customer = await prisma.customer.findUnique({
    where: { id },
  });
  if (!customer) notFound();

  const now = new Date();
  const [openTodos, overdueTodos, openInterventions, buckets, playbook] = await Promise.all([
    prisma.basecampTodo.count({
      where: { basecamp_project_id: customer.basecamp_project_id ?? "__none__", completed: false },
    }),
    prisma.basecampTodo.count({
      where: {
        basecamp_project_id: customer.basecamp_project_id ?? "__none__",
        completed: false,
        due_on: { lt: now },
      },
    }),
    prisma.intervention.count({ where: { customer_id: id, status: "open" } }),
    prisma.bucket.findMany({
      where: { customer_id: id, status: "active" },
      orderBy: { purchased_at: "desc" },
      take: 5,
      select: { id: true, hours_purchased: true, hours_used: true, hours_balance: true, purchased_at: true, status: true },
    }),
    // ClientPlaybook uses client_id (UUID) from customer.uuid_id or string id mapping
    // Try by string id — if customer has a uuid field use that; fall back gracefully
    prisma.clientPlaybook.findFirst({
      where: { client_id: String(id) },
    }).catch(() => null),
  ]);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <Link href="/customers" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-3">
          <ArrowLeft className="w-4 h-4" /> Back to clients
        </Link>
        <div className="flex items-center gap-3">
          <Building2 className="w-7 h-7 text-blue-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{customer.name}</h1>
            <p className="text-sm text-gray-500">
              Tier: {customer.effective_tier ?? "—"} ·{" "}
              <Badge variant={customer.active ? "success" : "muted"}>
                {customer.active ? "Active" : "Inactive"}
              </Badge>
            </p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Open Tasks" value={openTodos} variant={openTodos > 0 ? "default" : "success"} />
        <KpiCard label="Overdue" value={overdueTodos} variant={overdueTodos > 0 ? "danger" : "default"} />
        <KpiCard label="Escalations" value={openInterventions} variant={openInterventions > 0 ? "warning" : "default"} />
        <KpiCard
          label="Health Score"
          value={customer.client_health_score != null ? `${customer.client_health_score}%` : "—"}
          variant={
            customer.client_health_score == null ? "default"
            : customer.client_health_score >= 80 ? "success"
            : customer.client_health_score >= 60 ? "warning"
            : "danger"
          }
        />
      </div>

      {/* Details */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Integrations</p>
          <div className="space-y-1 text-sm">
            <p><span className="text-gray-500">Basecamp:</span> {customer.basecamp_project_id
              ? <span className="font-mono text-xs text-gray-800">{customer.basecamp_project_id}</span>
              : <span className="text-gray-400">Not connected</span>}
            </p>
            <p><span className="text-gray-500">Clockify:</span> {customer.clockify_client_id
              ? <span className="font-mono text-xs text-gray-800">{customer.clockify_client_id}</span>
              : <span className="text-gray-400">Not connected</span>}
            </p>
            <p><span className="text-gray-500">Slack:</span> {customer.slack_channel_id
              ? <span className="font-mono text-xs text-gray-800">{customer.slack_channel_id}</span>
              : <span className="text-gray-400">Not connected</span>}
            </p>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Billing</p>
          <div className="space-y-1 text-sm">
            <p><span className="text-gray-500">Bucket balance:</span>{" "}
              <span className="font-semibold">{customer.bucket_balance != null ? `${Number(customer.bucket_balance).toFixed(1)}h` : "—"}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Hour buckets */}
      {buckets.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Hour Buckets</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Purchased</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Bought</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Used</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Balance</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {buckets.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-2 text-gray-600">
                    {b.purchased_at.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                  <td className="px-4 py-2 text-right">{Number(b.hours_purchased).toFixed(1)}h</td>
                  <td className="px-4 py-2 text-right">{Number(b.hours_used).toFixed(1)}h</td>
                  <td className="px-4 py-2 text-right font-semibold">
                    <span className={Number(b.hours_balance) < 5 ? "text-red-600" : "text-emerald-600"}>
                      {Number(b.hours_balance).toFixed(1)}h
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={b.status === "active" ? "success" : "muted"}>{b.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Client Playbook */}
      {playbook && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-500" />
              <h2 className="text-sm font-semibold text-gray-900">Client Playbook</h2>
            </div>
            {playbook.last_built_at && (
              <span className="text-xs text-gray-400">
                Updated {new Date(playbook.last_built_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            )}
          </div>
          <div className="p-5 space-y-4">
            {/* Top Rules */}
            {Array.isArray(playbook.top_rules) && (playbook.top_rules as unknown[]).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Top Rules</p>
                <ul className="space-y-1.5">
                  {(playbook.top_rules as unknown[]).map((rule, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{typeof rule === "string" ? rule : JSON.stringify(rule)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* Signals */}
            {playbook.signals_json &&
              typeof playbook.signals_json === "object" &&
              Object.keys(playbook.signals_json as object).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Signals</p>
                <pre className="text-xs bg-gray-50 rounded p-3 overflow-auto max-h-40 text-gray-700">
                  {JSON.stringify(playbook.signals_json, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}