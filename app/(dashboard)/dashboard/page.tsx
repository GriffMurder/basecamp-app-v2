import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle, Clock, Users, Building2, TrendingUp } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

async function getCommandCenterData(session: Awaited<ReturnType<typeof requireAuth>>) {
  const role = (session.user as { role?: string }).role ?? "";

  const [
    activeVas,
    totalClients,
    todoStats,
    hoursToday,
    pendingApprovals,
    pendingUsers,
    atRiskClients,
    openInterventions,
  ] = await Promise.allSettled([
    // Active VAs
    prisma.person.count({ where: { role: "va", active: true } }),
    // Total active clients
    prisma.customer.count({ where: { active: true } }),
    // Open + overdue todos
    prisma.basecampTodo.aggregate({
      where: { completed: false },
      _count: { id: true },
    }).then(async (open) => {
      const now = new Date();
      const overdue = await prisma.basecampTodo.count({
        where: { completed: false, due_on: { lt: now } },
      });
      const total = await prisma.basecampTodo.count();
      const completed = total - open._count.id;
      const healthScore = total > 0 ? Math.round((completed / total) * 100) : 100;
      return { open: open._count.id, overdue, healthScore };
    }),
    // Hours tracked today
    prisma.timeEntry.aggregate({
      where: {
        start_time: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        status: { not: "rejected" },
      },
      _sum: { duration_minutes: true },
    }).then(r => Math.round(((r._sum.duration_minutes as unknown as number) ?? 0) / 60 * 10) / 10),
    // Pending time entry approvals
    prisma.timeEntry.count({ where: { status: "submitted" } }),
    // Pending user approvals (admin/owner only)
    role === "owner" || role === "super_admin"
      ? prisma.dashboardUser.findMany({
          where: { role: "pending" },
          orderBy: { created_at: "desc" },
          select: { id: true, email: true, display_name: true, created_at: true },
        })
      : Promise.resolve([]),
    // At-risk clients (open escalations)
    prisma.customer.findMany({
      where: { active: true },
      select: {
        id: true, name: true, effective_tier: true,
        basecamp_project_id: true,
      },
      orderBy: { name: "asc" },
      take: 15,
    }),
    // Open interventions count
    prisma.intervention.count({ where: { status: "open" } }),
  ]);

  return {
    kpis: {
      activeVas: activeVas.status === "fulfilled" ? activeVas.value : 0,
      totalClients: totalClients.status === "fulfilled" ? totalClients.value : 0,
      openTodos: todoStats.status === "fulfilled" ? todoStats.value.open : 0,
      overdueTodos: todoStats.status === "fulfilled" ? todoStats.value.overdue : 0,
      healthScore: todoStats.status === "fulfilled" ? todoStats.value.healthScore : 100,
      hoursToday: hoursToday.status === "fulfilled" ? hoursToday.value : 0,
      pendingApprovals: pendingApprovals.status === "fulfilled" ? pendingApprovals.value : 0,
      openInterventions: openInterventions.status === "fulfilled" ? openInterventions.value : 0,
    },
    pendingUsers: pendingUsers.status === "fulfilled" ? pendingUsers.value : [],
    clients: atRiskClients.status === "fulfilled" ? atRiskClients.value : [],
    role,
  };
}

export default async function DashboardPage() {
  const session = await requireAuth();
  const { kpis, pendingUsers, clients, role } = await getCommandCenterData(session);
  const user = session.user as { email?: string; name?: string; role?: string };

  const healthVariant = kpis.healthScore >= 80 ? "success" : kpis.healthScore >= 60 ? "warning" : "danger";

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Command Center</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Welcome, <span className="font-medium">{user.name ?? user.email}</span>
            {role && (
              <span className="ml-2">
                <Badge variant={role === "owner" ? "default" : role === "super_admin" ? "danger" : "muted"}>
                  {role.replace("_", " ")}
                </Badge>
              </span>
            )}
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          <Clock className="w-4 h-4" />
          Refresh
        </Link>
      </div>

      {/* Action alerts */}
      {(kpis.overdueTodos > 0 || kpis.openInterventions > 0 || kpis.pendingApprovals > 0) ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Action Required</p>
          {kpis.overdueTodos > 0 && (
            <Link href="/todos?overdue=1" className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 hover:bg-red-100 transition-colors">
              <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-800">{kpis.overdueTodos} overdue task{kpis.overdueTodos !== 1 ? "s" : ""}</p>
                <p className="text-xs text-red-600">Tasks past their due date with no completion</p>
              </div>
            </Link>
          )}
          {kpis.openInterventions > 0 && (
            <Link href="/insights" className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 hover:bg-amber-100 transition-colors">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-800">{kpis.openInterventions} open escalation{kpis.openInterventions !== 1 ? "s" : ""}</p>
                <p className="text-xs text-amber-600">Interventions awaiting resolution</p>
              </div>
            </Link>
          )}
          {kpis.pendingApprovals > 0 && (
            <Link href="/admin/time" className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 hover:bg-blue-100 transition-colors">
              <Clock className="w-5 h-5 text-blue-500 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-blue-800">{kpis.pendingApprovals} time entr{kpis.pendingApprovals !== 1 ? "ies" : "y"} pending approval</p>
                <p className="text-xs text-blue-600">Submitted time entries awaiting review</p>
              </div>
            </Link>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
          <CheckCircle className="w-5 h-5 text-emerald-500" />
          <p className="text-sm text-emerald-700 font-medium">All clear — no immediate actions required</p>
        </div>
      )}

      {/* KPI Strip */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Company Snapshot</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Health Score" value={`${kpis.healthScore}%`} variant={healthVariant} />
          <KpiCard label="Active VAs" value={kpis.activeVas} />
          <KpiCard label="Clients" value={kpis.totalClients} />
          <KpiCard label="Open Tasks" value={kpis.openTodos} />
          <KpiCard label="Overdue" value={kpis.overdueTodos} variant={kpis.overdueTodos > 0 ? "danger" : "default"} />
          <KpiCard label="Hours Today" value={`${kpis.hoursToday}h`} variant="info" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Client Health Table */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-500" />
              Client Health Snapshot
            </h2>
            <Link href="/customers" className="text-xs text-blue-600 hover:underline">View all →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Tier</th>
                  <th className="text-center px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {clients.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400 text-sm">No clients found</td></tr>
                )}
                {clients.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-900">
                      <Link href={`/customers/${c.id}`} className="hover:text-blue-600">{c.name}</Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="muted">{c.effective_tier ?? "—"}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Badge variant={c.basecamp_project_id ? "success" : "muted"}>
                        {c.basecamp_project_id ? "Connected" : "No BC"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right column: Pending Users + Quick Links */}
        <div className="space-y-4">
          {/* Pending user approvals */}
          {(role === "owner" || role === "super_admin") && pendingUsers.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-amber-200">
              <div className="flex items-center justify-between px-4 py-3 border-b border-amber-100 bg-amber-50 rounded-t-lg">
                <h2 className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Pending Approvals
                </h2>
                <Badge variant="warning">{pendingUsers.length}</Badge>
              </div>
              <div className="divide-y divide-gray-100">
                {pendingUsers.slice(0, 5).map((u) => (
                  <div key={u.id} className="px-4 py-2.5 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{u.display_name || u.email}</p>
                      <p className="text-xs text-gray-400">{u.email}</p>
                    </div>
                    <Link
                      href={`/admin/users?approve=${u.id}`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Review →
                    </Link>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2 border-t border-gray-100">
                <Link href="/admin/users" className="text-xs text-blue-600 hover:underline">
                  Manage all users →
                </Link>
              </div>
            </div>
          )}

          {/* Quick links */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-500" />
                Quick Links
              </h2>
            </div>
            <div className="p-4 space-y-2">
              {[
                { href: "/todos", label: "View all tasks" },
                { href: "/insights", label: "Ops insights" },
                { href: "/vas", label: "Team overview" },
                { href: "/customers", label: "Client list" },
              ].map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="block text-sm text-blue-600 hover:underline"
                >
                  → {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}