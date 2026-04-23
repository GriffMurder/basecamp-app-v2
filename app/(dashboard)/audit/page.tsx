import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Shield, FileText } from "lucide-react";

export const dynamic = "force-dynamic";

type TabType = "interactions" | "interventions" | "ai_tasks";

const TAB_LABELS: Record<TabType, string> = {
  interactions: "Interactions",
  interventions: "Interventions",
  ai_tasks: "AI Tasks",
};

function interventionStatusVariant(status: string): "success" | "warning" | "danger" | "muted" {
  if (status === "resolved") return "success";
  if (status === "open") return "warning";
  if (status === "escalated") return "danger";
  return "muted";
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  await requireAdmin();

  const { tab: rawTab, page: pageStr } = await searchParams;
  const tab = (rawTab ?? "interventions") as TabType;
  const page = Math.max(1, parseInt(pageStr ?? "1"));
  const pageSize = 50;
  const skip = (page - 1) * pageSize;

  const [
    interactionCount,
    interventionCount,
    aiTaskCount,
    interactions,
    interventions,
    aiTasks,
    allCustomers,
  ] = await Promise.all([
    prisma.interaction.count(),
    prisma.intervention.count(),
    prisma.aiTask.count(),
    tab === "interactions"
      ? prisma.interaction.findMany({
          take: pageSize, skip, orderBy: { happened_at: "desc" },
          select: {
            id: true, source: true, customer_id: true,
            interaction_type: true, happened_at: true, todo_id: true,
          },
        })
      : Promise.resolve([]),
    tab === "interventions"
      ? prisma.intervention.findMany({
          take: pageSize, skip, orderBy: { created_at: "desc" },
          select: {
            id: true, level: true, reason: true, target_person_id: true,
            customer_id: true, status: true, created_at: true,
            sent_at: true, resolved_at: true, resolution_kind: true,
            root_cause_category: true, sla_breached_at: true,
          },
        })
      : Promise.resolve([]),
    tab === "ai_tasks"
      ? prisma.aiTask.findMany({
          take: pageSize, skip, orderBy: { created_at: "desc" },
          select: {
            id: true, basecamp_todo_id: true, title: true,
            status: true, created_at: true, updated_at: true,
          },
        })
      : Promise.resolve([]),
    prisma.customer.findMany({ select: { id: true, name: true } }),
  ]);

  const customerMap = new Map(allCustomers.map((c) => [c.id, c.name]));

  const totalItems =
    tab === "interactions" ? interactionCount :
    tab === "interventions" ? interventionCount :
    aiTaskCount;
  const totalPages = Math.ceil(totalItems / pageSize);

  const tabs: TabType[] = ["interventions", "interactions", "ai_tasks"];

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Shield className="w-6 h-6 text-blue-500" />
          Audit Log
        </h1>
        <a
          href="/api/exports?type=interventions"
          className="px-3 py-1.5 text-sm bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 transition-colors flex items-center gap-1.5"
        >
          <FileText className="w-3.5 h-3.5" />
          Export CSV
        </a>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Interactions" value={interactionCount} />
        <KpiCard
          label="Interventions"
          value={interventionCount}
          variant="warning"
        />
        <KpiCard label="AI Tasks" value={aiTaskCount} variant="info" />
      </div>

      {/* Tab nav */}
      <div className="flex gap-2 border-b border-gray-200">
        {tabs.map((t) => (
          <a
            key={t}
            href={`?tab=${t}`}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {TAB_LABELS[t]}
          </a>
        ))}
      </div>

      {/* Interventions table */}
      {tab === "interventions" && (
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">ID</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Level</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Reason</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Customer</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Root Cause</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">SLA Breach</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {interventions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                    No interventions found
                  </td>
                </tr>
              ) : (
                interventions.map((i) => (
                  <tr key={String(i.id)} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{String(i.id)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={i.level === "critical" ? "danger" : i.level === "warning" ? "warning" : "muted"}>
                        {i.level}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-xs truncate">{i.reason}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {i.customer_id ? (
                        <a href={`/customers/${i.customer_id}`} className="hover:underline text-blue-600">
                          {customerMap.get(i.customer_id) ?? `#${i.customer_id}`}
                        </a>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={interventionStatusVariant(i.status)}>
                        {i.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{i.root_cause_category ?? "—"}</td>
                    <td className="px-4 py-3 text-xs">
                      {i.sla_breached_at ? (
                        <span className="text-red-600">{i.sla_breached_at.toLocaleDateString()}</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {i.created_at?.toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Interactions table */}
      {tab === "interactions" && (
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Source</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Type</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Customer</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Todo ID</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Happened At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {interactions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    No interactions found
                  </td>
                </tr>
              ) : (
                interactions.map((i) => (
                  <tr key={String(i.id)} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{i.source}</td>
                    <td className="px-4 py-3">
                      <Badge variant="default">{i.interaction_type}</Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {i.customer_id ? (
                        <a href={`/customers/${i.customer_id}`} className="hover:underline text-blue-600">
                          {customerMap.get(i.customer_id) ?? `#${i.customer_id}`}
                        </a>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{i.todo_id ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {i.happened_at?.toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* AI Tasks table */}
      {tab === "ai_tasks" && (
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">ID</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Todo ID</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Title</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Created</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {aiTasks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    No AI tasks found
                  </td>
                </tr>
              ) : (
                aiTasks.map((t) => (
                  <tr key={String(t.id)} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{String(t.id)}</td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{t.basecamp_todo_id}</td>
                    <td className="px-4 py-3 text-gray-700 max-w-xs truncate">{t.title ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Badge variant={t.status === "open" ? "warning" : t.status === "closed" ? "success" : "muted"}>
                        {t.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {t.created_at?.toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {t.updated_at?.toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            Page {page} of {totalPages} ({totalItems} total)
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <a
                href={`?tab=${tab}&page=${page - 1}`}
                className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                ← Prev
              </a>
            )}
            {page < totalPages && (
              <a
                href={`?tab=${tab}&page=${page + 1}`}
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
