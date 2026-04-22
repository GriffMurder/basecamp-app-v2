import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { Settings, Users, UserCheck, UserX } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  await requireRole(["super_admin", "owner"]);

  const users = await prisma.dashboardUser.findMany({
    orderBy: [{ role: "asc" }, { display_name: "asc" }],
    select: {
      id: true, email: true, display_name: true, role: true,
      active: true, org_id: true, created_at: true, last_login_at: true,
    },
  });

  const counts = {
    total: users.length,
    pending: users.filter(u => u.role === "pending").length,
    active: users.filter(u => u.active && u.role !== "pending").length,
    inactive: users.filter(u => !u.active).length,
  };

  function roleVariant(role: string): "danger" | "warning" | "default" | "info" | "muted" {
    if (role === "owner") return "danger";
    if (role === "super_admin") return "warning";
    if (role === "manager") return "default";
    if (role === "va") return "info";
    return "muted";
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        <Settings className="w-6 h-6 text-blue-500" />
        User Management
      </h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Users" value={counts.total} />
        <KpiCard label="Active" value={counts.active} variant="success" />
        <KpiCard label="Pending" value={counts.pending} variant={counts.pending > 0 ? "warning" : "default"} />
        <KpiCard label="Inactive" value={counts.inactive} variant="muted" />
      </div>

      {/* Pending section */}
      {counts.pending > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-amber-200 flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-amber-600" />
            <h2 className="text-sm font-semibold text-amber-800">Pending Approvals</h2>
            <Badge variant="warning">{counts.pending}</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-amber-50">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-amber-700 uppercase">Email</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-amber-700 uppercase">Name</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-amber-700 uppercase">Signed Up</th>
                  <th className="px-4 py-2 text-xs font-semibold text-amber-700 uppercase text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100">
                {users.filter(u => u.role === "pending").map((u) => (
                  <tr key={u.id} className="bg-white hover:bg-amber-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{u.email}</td>
                    <td className="px-4 py-2.5 text-gray-900">{u.display_name || "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">
                      {u.created_at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <ApproveButtons userId={u.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* All users table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-500" />
          <h2 className="text-sm font-semibold text-gray-900">All Users</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Role</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Last Login</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.filter(u => u.role !== "pending").map((u) => (
                <tr key={u.id} className={`hover:bg-gray-50 ${!u.active ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2.5 font-medium text-gray-900">{u.display_name || "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 font-mono">{u.email}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={roleVariant(u.role)}>{u.role.replace("_", " ")}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    {u.active
                      ? <span className="flex items-center gap-1 text-emerald-600 text-xs font-medium"><UserCheck className="w-3 h-3" /> Active</span>
                      : <span className="flex items-center gap-1 text-gray-400 text-xs"><UserX className="w-3 h-3" /> Inactive</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {u.last_login_at
                      ? u.last_login_at.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                      : "Never"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {u.created_at.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Minimal approve buttons — client component for interactivity
function ApproveButtons({ userId }: { userId: number }) {
  return (
    <div className="flex gap-1 justify-end">
      <form action={`/api/users`} method="POST">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="role" value="manager" />
        <button type="submit"
          className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
          Manager
        </button>
      </form>
      <form action={`/api/users`} method="POST">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="role" value="va" />
        <button type="submit"
          className="px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700">
          VA
        </button>
      </form>
      <form action={`/api/users/${userId}`} method="POST">
        <input type="hidden" name="_method" value="DELETE" />
        <button type="submit"
          className="px-2 py-1 text-xs bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100">
          Reject
        </button>
      </form>
    </div>
  );
}