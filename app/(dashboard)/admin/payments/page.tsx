import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CreditCard } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  await requireAdmin();

  const events = await prisma.paymentEvent.findMany({
    orderBy: { created_at: "desc" },
    take: 200,
    select: {
      id: true,
      provider: true,
      event_type: true,
      provider_ref: true,
      amount_cents: true,
      currency: true,
      customer_id: true,
      bucket_id: true,
      status: true,
      error: true,
      created_at: true,
    },
  });

  const totalRevenue = events
    .filter((e) => e.status === "provisioned" && e.amount_cents)
    .reduce((s, e) => s + (e.amount_cents ?? 0), 0);

  const byProvider: Record<string, number> = {};
  for (const e of events) {
    byProvider[e.provider] = (byProvider[e.provider] ?? 0) + 1;
  }

  function statusBadge(status: string) {
    const cls =
      status === "provisioned"
        ? "bg-emerald-100 text-emerald-700"
        : status === "received"
        ? "bg-blue-100 text-blue-700"
        : status === "error"
        ? "bg-red-100 text-red-700"
        : "bg-gray-100 text-gray-500";
    return (
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls} capitalize`}>
        {status}
      </span>
    );
  }

  function providerBadge(provider: string) {
    const cls =
      provider === "stripe"
        ? "bg-indigo-100 text-indigo-700"
        : provider === "paypal"
        ? "bg-blue-100 text-blue-700"
        : provider === "veem"
        ? "bg-teal-100 text-teal-700"
        : "bg-gray-100 text-gray-500";
    return (
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls} capitalize`}>
        {provider}
      </span>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <CreditCard className="w-6 h-6 text-indigo-500" />
        <h1 className="text-2xl font-bold text-gray-900">Payment History</h1>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{events.length}</p>
          <p className="text-xs text-gray-500 mt-0.5">Total Events</p>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-emerald-700">
            ${(totalRevenue / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">Total Provisioned</p>
        </div>
        {Object.entries(byProvider).map(([provider, count]) => (
          <div key={provider} className="bg-white rounded-lg border shadow-sm p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">{count}</p>
            <p className="text-xs text-gray-500 mt-0.5 capitalize">{provider} Events</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Events</h2>
        </div>
        {events.length === 0 ? (
          <p className="px-4 py-10 text-center text-gray-400">No payment events recorded yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {["Provider", "Event Type", "Amount", "Customer", "Status", "Reference", "Date"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {events.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">{providerBadge(e.provider)}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-600 font-mono">{e.event_type}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">
                    {e.amount_cents != null
                      ? `$${(e.amount_cents / 100).toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {e.customer_id ? `#${e.customer_id}` : "—"}
                  </td>
                  <td className="px-4 py-2.5">{statusBadge(e.status)}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-400 font-mono max-w-[120px] truncate">
                    {e.provider_ref ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">
                    {e.created_at ? new Date(e.created_at).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
