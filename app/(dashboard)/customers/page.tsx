import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import Link from "next/link";
import { Building2, Search } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; inactive?: string }>;
}) {
  await requireAuth();

  const { q: rawQ, inactive } = await searchParams;
  const q = rawQ ?? "";
  const showInactive = inactive === "1";

  const customers = await prisma.customer.findMany({
    where: {
      active: showInactive ? undefined : true,
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: { name: "asc" },
    take: 200,
    select: {
      id: true, name: true, active: true, effective_tier: true,
      client_health_score: true, bucket_balance: true,
      basecamp_project_id: true, slack_channel_id: true,
      last_scored_at: true,
    },
  });

  const activeCount = customers.filter(c => c.active).length;
  const tierCounts = customers.reduce<Record<string, number>>((acc, c) => {
    const t = c.effective_tier ?? "Untiered";
    acc[t] = (acc[t] ?? 0) + 1;
    return acc;
  }, {});

  function tierVariant(tier: string | null): "success" | "default" | "warning" | "muted" {
    if (tier === "A") return "success";
    if (tier === "B") return "default";
    if (tier === "C") return "warning";
    return "muted";
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Building2 className="w-6 h-6 text-blue-500" />
          Clients
        </h1>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Active Clients" value={activeCount} variant="success" />
        {Object.entries(tierCounts).slice(0, 3).map(([tier, count]) => (
          <KpiCard key={tier} label={`Tier ${tier}`} value={count} />
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <form method="GET" className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search clients…"
              className="pl-8 pr-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
            />
          </div>
          <button type="submit" className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700">
            Search
          </button>
        </form>
        <Link
          href={showInactive ? "/customers" : "/customers?inactive=1"}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50"
        >
          {showInactive ? "Active only" : "Show inactive"}
        </Link>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Tier</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Health</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Bucket Balance</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Integrations</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {customers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">No clients found</td>
              </tr>
            )}
            {customers.map((c) => (
              <tr key={c.id} className={`hover:bg-gray-50 ${!c.active ? "opacity-50" : ""}`}>
                <td className="px-4 py-2.5 font-medium text-gray-900">
                  <Link href={`/customers/${c.id}`} className="hover:text-blue-600">{c.name}</Link>
                </td>
                <td className="px-4 py-2.5">
                  <Badge variant={tierVariant(c.effective_tier)}>{c.effective_tier ?? "—"}</Badge>
                </td>
                <td className="px-4 py-2.5 text-right">
                  {c.client_health_score != null ? (
                    <span className={c.client_health_score >= 80 ? "text-emerald-600 font-semibold" : c.client_health_score >= 60 ? "text-amber-600 font-semibold" : "text-red-600 font-semibold"}>
                      {c.client_health_score}%
                    </span>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-2.5 text-right text-gray-700">
                  {c.bucket_balance != null ? `${Number(c.bucket_balance).toFixed(1)}h` : "—"}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1">
                    {c.basecamp_project_id && <Badge variant="success">BC</Badge>}
                    {c.slack_channel_id && <Badge variant="info">Slack</Badge>}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <Badge variant={c.active ? "success" : "muted"}>{c.active ? "Active" : "Inactive"}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}