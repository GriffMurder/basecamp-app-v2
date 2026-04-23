/**
 * app/(dashboard)/admin/scores/page.tsx
 *
 * System health + scores dashboard.
 * Shows current system health (DB ping), recent ScoreDaily rows for both
 * VAs and Customers, and a breakdown by score_type.
 */
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Activity, Database, Users, Building2, TrendingUp, TrendingDown } from "lucide-react";

export const dynamic = "force-dynamic";

const SCORE_TYPE_LABELS: Record<string, string> = {
  va_reliability:    "VA Reliability",
  va_capacity_index: "VA Capacity Index",
  client_health:     "Client Health",
  client_difficulty: "Client Difficulty",
  reliability:       "Reliability (legacy)",
};

function band(score: number): { label: string; cls: string } {
  if (score >= 75) return { label: "A", cls: "bg-green-100 text-green-700" };
  if (score >= 50) return { label: "B", cls: "bg-amber-100 text-amber-700" };
  return { label: "C", cls: "bg-red-100 text-red-700" };
}

export default async function ScoresDashboardPage() {
  await requireAdmin();

  // Health check
  let dbOk = false;
  let dbError: string | null = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (err) {
    dbError = String(err).slice(0, 200);
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [latestVaScores, latestClientScores, scoreSummary, tierCounts] = await Promise.all([
    // Latest VA scores (today or most recent)
    prisma.scoreDaily.findMany({
      where: {
        score_type: { in: ["va_reliability", "va_capacity_index", "reliability"] },
        person_id: { not: null },
      },
      orderBy: [{ day: "desc" }, { person_id: "asc" }],
      take: 100,
    }),
    // Latest client scores
    prisma.scoreDaily.findMany({
      where: {
        score_type: { in: ["client_health", "client_difficulty"] },
        customer_id: { not: null },
      },
      orderBy: [{ day: "desc" }, { customer_id: "asc" }],
      take: 100,
    }),
    // Score type counts
    prisma.scoreDaily.groupBy({
      by: ["score_type"],
      _count: { id: true },
      _avg: { score_value: true },
      orderBy: { score_type: "asc" },
    }),
    // Tier distribution
    prisma.tier.groupBy({
      by: ["effective_tier"],
      _count: { id: true },
      orderBy: { effective_tier: "asc" },
    }),
  ]);

  // Deduplicate VA scores (one per person_id per score_type — most recent)
  const vaByPersonType = new Map<string, typeof latestVaScores[0]>();
  for (const row of latestVaScores) {
    const key = `${row.person_id}:${row.score_type}`;
    if (!vaByPersonType.has(key)) vaByPersonType.set(key, row);
  }
  const dedupedVa = Array.from(vaByPersonType.values());

  // Deduplicate client scores
  const clientByCustType = new Map<string, typeof latestClientScores[0]>();
  for (const row of latestClientScores) {
    const key = `${row.customer_id}:${row.score_type}`;
    if (!clientByCustType.has(key)) clientByCustType.set(key, row);
  }
  const dedupedClient = Array.from(clientByCustType.values());

  // Group VA scores by person
  const vaByPerson = new Map<number, Map<string, number>>();
  for (const row of dedupedVa) {
    if (!row.person_id) continue;
    if (!vaByPerson.has(row.person_id)) vaByPerson.set(row.person_id, new Map());
    vaByPerson.get(row.person_id)!.set(row.score_type, Number(row.score_value));
  }

  // Group client scores by customer
  const clientByCustomer = new Map<number, Map<string, number>>();
  for (const row of dedupedClient) {
    if (!row.customer_id) continue;
    if (!clientByCustomer.has(row.customer_id)) clientByCustomer.set(row.customer_id, new Map());
    clientByCustomer.get(row.customer_id)!.set(row.score_type, Number(row.score_value));
  }

  // VA display names
  const vaIds = Array.from(vaByPerson.keys());
  const clientIds = Array.from(clientByCustomer.keys());

  const [vaNames, customerNames] = await Promise.all([
    vaIds.length
      ? prisma.va.findMany({ where: { id: { in: vaIds } }, select: { id: true, display_name: true } })
      : Promise.resolve([]),
    clientIds.length
      ? prisma.customer.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true, effective_tier: true } })
      : Promise.resolve([]),
  ]);

  const vaNameMap = new Map(vaNames.map((v) => [v.id, v.display_name]));
  const custNameMap = new Map(customerNames.map((c) => [c.id, { name: c.name, tier: c.effective_tier }]));

  const tierMap = new Map(tierCounts.map((t) => [t.effective_tier, t._count.id]));

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Activity className="h-7 w-7 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Scores &amp; Health</h1>
          <p className="text-sm text-gray-500">System status, VA reliability &amp; client health scores</p>
        </div>
      </div>

      {/* System health row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={`rounded-xl border p-5 flex items-center gap-4 ${dbOk ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
          <Database className={`h-8 w-8 ${dbOk ? "text-green-600" : "text-red-600"}`} />
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Database</div>
            <div className={`text-lg font-bold ${dbOk ? "text-green-700" : "text-red-700"}`}>
              {dbOk ? "Connected" : "Error"}
            </div>
            {dbError && <div className="text-xs text-red-600 mt-1 truncate max-w-[200px]">{dbError}</div>}
          </div>
        </div>
        <div className="rounded-xl border p-5 flex items-center gap-4 bg-white">
          <Users className="h-8 w-8 text-blue-500" />
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">VAs Scored</div>
            <div className="text-lg font-bold">{vaByPerson.size}</div>
          </div>
        </div>
        <div className="rounded-xl border p-5 flex items-center gap-4 bg-white">
          <Building2 className="h-8 w-8 text-purple-500" />
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Clients Scored</div>
            <div className="text-lg font-bold">{clientByCustomer.size}</div>
          </div>
        </div>
      </div>

      {/* Tier distribution */}
      {tierCounts.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Customer Tier Distribution</h2>
          <div className="flex gap-3 flex-wrap">
            {(["A", "B", "C"] as const).map((tier) => (
              <div key={tier} className="rounded-lg border px-6 py-4 text-center min-w-[80px]">
                <div className={`text-2xl font-bold ${tier === "A" ? "text-green-700" : tier === "B" ? "text-amber-700" : "text-red-700"}`}>
                  {tierMap.get(tier) ?? 0}
                </div>
                <div className="text-xs text-gray-500 mt-1">Tier {tier}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Score type averages */}
      {scoreSummary.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Score Averages (All Time)</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {scoreSummary.map((row) => {
              const avg = row._avg.score_value ? Number(row._avg.score_value) : null;
              const b = avg != null ? band(avg) : null;
              return (
                <div key={row.score_type} className="rounded-xl border p-4">
                  <div className="text-xs text-gray-500 mb-1">
                    {SCORE_TYPE_LABELS[row.score_type] ?? row.score_type}
                  </div>
                  <div className="text-xl font-bold">
                    {avg != null ? Math.round(avg) : "—"}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    {b && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${b.cls}`}>
                        {b.label}
                      </span>
                    )}
                    <span className="text-xs text-gray-400">{row._count.id} rows</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* VA scores table */}
      {vaByPerson.size > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-500" /> VA Scores
          </h2>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="px-4 py-3 font-medium">VA</th>
                  <th className="px-4 py-3 font-medium">Reliability</th>
                  <th className="px-4 py-3 font-medium">Capacity Index</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(vaByPerson.entries()).map(([vid, scoreMap]) => {
                  const rel   = scoreMap.get("va_reliability") ?? scoreMap.get("reliability");
                  const cap   = scoreMap.get("va_capacity_index");
                  const bRel  = rel  != null ? band(rel) : null;
                  const bCap  = cap  != null ? band(cap) : null;
                  return (
                    <tr key={vid} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">
                        {vaNameMap.get(vid) ?? `VA #${vid}`}
                      </td>
                      <td className="px-4 py-3">
                        {rel != null ? (
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full ${bRel!.cls}`}>
                            {rel >= 50 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {Math.round(rel)}
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {cap != null ? (
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full ${bCap!.cls}`}>
                            {cap >= 50 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {Math.round(cap)}
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Client scores table */}
      {clientByCustomer.size > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-purple-500" /> Client Scores
          </h2>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Tier</th>
                  <th className="px-4 py-3 font-medium">Health</th>
                  <th className="px-4 py-3 font-medium">Difficulty</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(clientByCustomer.entries()).map(([cid, scoreMap]) => {
                  const health = scoreMap.get("client_health");
                  const diff   = scoreMap.get("client_difficulty");
                  const bH     = health != null ? band(health) : null;
                  const bD     = diff   != null ? band(diff)   : null;
                  const custInfo = custNameMap.get(cid);
                  const tier   = custInfo?.tier;
                  return (
                    <tr key={cid} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">
                        {custInfo?.name ?? `Client #${cid}`}
                      </td>
                      <td className="px-4 py-3">
                        {tier ? (
                          <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${band(tier === "A" ? 80 : tier === "B" ? 60 : 30).cls}`}>
                            {tier}
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {health != null ? (
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full ${bH!.cls}`}>
                            {health >= 50 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {Math.round(health)}
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {diff != null ? (
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full ${bD!.cls}`}>
                            {Math.round(diff)}
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {vaByPerson.size === 0 && clientByCustomer.size === 0 && (
        <div className="text-center py-12 text-gray-400">
          No scores yet. Run the <strong>score-compute</strong> job from the Triggers page.
        </div>
      )}
    </div>
  );
}
