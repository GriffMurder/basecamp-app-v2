import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { DollarSign } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function BucketsPage() {
  await requireAuth();

  // Get all active buckets with customer name
  const buckets = await prisma.$queryRaw<
    {
      id: number;
      customer_id: number;
      customer_name: string;
      hours_purchased: string;
      hours_used: string;
      hours_balance: string;
      status: string;
      stripe_payment_id: string | null;
      purchased_at: Date;
      rollover_date: Date | null;
      is_bonus: boolean;
    }[]
  >`
    SELECT b.id, b.customer_id, c.name AS customer_name,
           b.hours_purchased, b.hours_used, b.hours_balance,
           b.status, b.stripe_payment_id, b.purchased_at, b.rollover_date, b.is_bonus
    FROM buckets b
    LEFT JOIN customers c ON c.id = b.customer_id
    ORDER BY b.status ASC, b.hours_balance DESC
    LIMIT 500
  `;

  const active = buckets.filter((b) => b.status === "active");
  const depleted = buckets.filter((b) => b.status === "depleted");
  const other = buckets.filter((b) => b.status !== "active" && b.status !== "depleted");

  const totalHoursBalance = active.reduce((s, b) => s + parseFloat(b.hours_balance), 0);
  const totalHoursUsed = buckets.reduce((s, b) => s + parseFloat(b.hours_used), 0);

  function statusBadge(status: string) {
    const cls =
      status === "active"
        ? "bg-emerald-100 text-emerald-700"
        : status === "depleted"
        ? "bg-red-100 text-red-700"
        : status === "cancelled"
        ? "bg-gray-100 text-gray-500"
        : "bg-amber-100 text-amber-700";
    return (
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls} capitalize`}>
        {status}
      </span>
    );
  }

  function BucketTable({ rows, title }: { rows: typeof buckets; title: string }) {
    if (rows.length === 0) return null;
    return (
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              {["Customer", "Purchased", "Used", "Balance", "Status", "Rollover", ""].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((b) => {
              const balance = parseFloat(b.hours_balance);
              const purchased = parseFloat(b.hours_purchased);
              const usedPct = purchased > 0 ? (parseFloat(b.hours_used) / purchased) * 100 : 0;
              return (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/customers/${b.customer_id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {b.customer_name ?? `Customer #${b.customer_id}`}
                    </Link>
                    {b.is_bonus && (
                      <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">
                        bonus
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{parseFloat(b.hours_purchased).toFixed(1)}h</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-600">{parseFloat(b.hours_used).toFixed(1)}h</span>
                      <div className="w-16 bg-gray-200 rounded-full h-1.5 hidden sm:block">
                        <div
                          className={`h-1.5 rounded-full ${usedPct > 90 ? "bg-red-500" : usedPct > 70 ? "bg-amber-400" : "bg-emerald-500"}`}
                          style={{ width: `${Math.min(usedPct, 100)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`font-semibold ${
                        balance <= 0
                          ? "text-red-600"
                          : balance < 5
                          ? "text-amber-600"
                          : "text-emerald-700"
                      }`}
                    >
                      {balance.toFixed(1)}h
                    </span>
                  </td>
                  <td className="px-4 py-2.5">{statusBadge(b.status)}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">
                    {b.rollover_date ? new Date(b.rollover_date).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      href={`/customers/${b.customer_id}`}
                      className="text-xs text-blue-500 hover:underline"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <DollarSign className="w-6 h-6 text-emerald-500" />
        <h1 className="text-2xl font-bold text-gray-900">Hour Buckets</h1>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Active Buckets", value: active.length.toString(), color: "text-emerald-600" },
          { label: "Depleted", value: depleted.length.toString(), color: "text-red-600" },
          { label: "Total Balance", value: `${totalHoursBalance.toFixed(1)}h`, color: "text-blue-600" },
          { label: "Total Used (all)", value: `${totalHoursUsed.toFixed(1)}h`, color: "text-gray-600" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-lg border shadow-sm p-4 text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <BucketTable rows={active} title={`Active Buckets (${active.length})`} />
      <BucketTable rows={depleted} title={`Depleted Buckets (${depleted.length})`} />
      <BucketTable rows={other} title={`Other Buckets (${other.length})`} />

      {buckets.length === 0 && (
        <div className="bg-white rounded-lg border shadow-sm p-12 text-center text-gray-400">
          No buckets found
        </div>
      )}
    </div>
  );
}
