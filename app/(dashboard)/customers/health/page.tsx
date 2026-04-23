import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import Link from "next/link";
import {
  Building2,
  AlertTriangle,
  CheckSquare,
  Clock,
  ShieldAlert,
} from "lucide-react";

export const dynamic = "force-dynamic";

async function getClientHealthData() {
  const customers = await prisma.customer.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      effective_tier: true,
      basecamp_project_id: true,
      created_at: true,
    },
    orderBy: { name: "asc" },
  });

  if (!customers.length) return { customers: [], summary: { total: 0, atRisk: 0, highTier: 0 } };

  // Pull per-customer metrics in parallel
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const metricsResults = await Promise.allSettled(
    customers.map(async (c) => {
      const [openTodos, overdueTodos, openEscalations, recentInteractions] = await Promise.all([
        prisma.basecampTodo.count({
          where: { basecamp_project_id: c.basecamp_project_id ?? undefined, completed: false },
        }),
        prisma.basecampTodo.count({
          where: {
            basecamp_project_id: c.basecamp_project_id ?? undefined,
            completed: false,
            due_on: { lt: now },
          },
        }),
        prisma.intervention.count({
          where: { customer_id: c.id, status: "open" },
        }),
        prisma.interaction.count({
          where: { customer_id: c.id, happened_at: { gte: sevenDaysAgo } },
        }),
      ]);

      return { openTodos, overdueTodos, openEscalations, recentInteractions };
    })
  );

  type CustomerRow = {
    id: number;
    name: string;
    tier: string | null;
    basecamp_project_id: string | null;
    openTodos: number;
    overdueTodos: number;
    openEscalations: number;
    recentInteractions: number;
    riskScore: number;
  };

  const rows: CustomerRow[] = customers.map((c, i) => {
    const m =
      metricsResults[i].status === "fulfilled"
        ? (metricsResults[i] as PromiseFulfilledResult<typeof metricsResults[0] extends PromiseFulfilledResult<infer T> ? T : never>).value
        : { openTodos: 0, overdueTodos: 0, openEscalations: 0, recentInteractions: 0 };

    // Risk score: higher = more at risk
    const riskScore =
      m.overdueTodos * 3 +
      m.openEscalations * 5 +
      (m.recentInteractions === 0 && m.openTodos > 0 ? 4 : 0) +
      m.openTodos;

    return {
      id: c.id,
      name: c.name,
      tier: c.effective_tier,
      basecamp_project_id: c.basecamp_project_id,
      ...m,
      riskScore,
    };
  });

  // Sort by risk descending
  rows.sort((a, b) => b.riskScore - a.riskScore);

  const atRisk = rows.filter(
    (r) => r.overdueTodos > 0 || r.openEscalations > 0
  ).length;
  const highTier = rows.filter((r) => r.tier === "A" || r.tier === "tier_a").length;

  return {
    customers: rows,
    summary: { total: rows.length, atRisk, highTier },
  };
}

function riskBadge(row: {
  overdueTodos: number;
  openEscalations: number;
  recentInteractions: number;
  openTodos: number;
}) {
  if (row.openEscalations > 0 || row.overdueTodos >= 3)
    return <Badge variant="danger">High Risk</Badge>;
  if (row.overdueTodos > 0 || (row.recentInteractions === 0 && row.openTodos > 0))
    return <Badge variant="warning">Watch</Badge>;
  return <Badge variant="success">Healthy</Badge>;
}

export default async function CustomerHealthPage() {
  await requireAuth();
  const { customers, summary } = await getClientHealthData();

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-orange-500" />
            Client Health Overview
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            All active clients sorted by risk level — overdue tasks, open escalations, activity.
          </p>
        </div>
        <Link
          href="/customers"
          className="text-sm text-blue-600 hover:underline"
        >
          ← All Clients
        </Link>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Active Clients" value={summary.total} />
        <KpiCard
          label="At-Risk Clients"
          value={summary.atRisk}
          variant={summary.atRisk > 0 ? "danger" : "success"}
        />
        <KpiCard label="Tier A Clients" value={summary.highTier} variant="info" />
      </div>

      {/* Client table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Client
              </th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Tier
              </th>
              <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Open Tasks
              </th>
              <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Overdue
              </th>
              <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Escalations
              </th>
              <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                7d Activity
              </th>
              <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Risk
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {customers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                  No active clients found
                </td>
              </tr>
            )}
            {customers.map((c) => (
              <tr
                key={c.id}
                className={
                  c.openEscalations > 0 || c.overdueTodos >= 3
                    ? "bg-red-50"
                    : c.overdueTodos > 0
                    ? "bg-amber-50"
                    : "hover:bg-gray-50"
                }
              >
                <td className="px-4 py-2.5">
                  <Link
                    href={`/customers/${c.id}`}
                    className="font-medium text-gray-900 hover:text-blue-600 hover:underline"
                  >
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  {c.tier ? (
                    <Badge variant="muted">{c.tier.toUpperCase()}</Badge>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span className="flex items-center justify-center gap-1 text-gray-700">
                    <CheckSquare className="w-3.5 h-3.5 text-gray-400" />
                    {c.openTodos}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  {c.overdueTodos > 0 ? (
                    <span className="flex items-center justify-center gap-1 font-semibold text-red-600">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {c.overdueTodos}
                    </span>
                  ) : (
                    <span className="text-gray-400">0</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {c.openEscalations > 0 ? (
                    <span className="font-semibold text-red-600">{c.openEscalations}</span>
                  ) : (
                    <span className="text-gray-400">0</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {c.recentInteractions > 0 ? (
                    <span className="flex items-center justify-center gap-1 text-emerald-600">
                      <Clock className="w-3.5 h-3.5" />
                      {c.recentInteractions}
                    </span>
                  ) : (
                    <span className="text-gray-400 text-xs">no activity</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-center">{riskBadge(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400 text-center">
        Risk score = overdue×3 + escalations×5 + open tasks. Refreshed on page load.
      </p>
    </div>
  );
}
