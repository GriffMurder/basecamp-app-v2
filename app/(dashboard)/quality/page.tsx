import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AlertTriangle, MessageSquareWarning, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

const EVENT_TYPE_META: Record<string, { label: string; colorClass: string; icon: string }> = {
  REVISION_REQUESTED: { label: "Revision Request", colorClass: "bg-amber-100 text-amber-700", icon: "✏️" },
  NEGATIVE_FEEDBACK: { label: "Negative Feedback", colorClass: "bg-red-100 text-red-700", icon: "⚠️" },
  CLIENT_NO_RESPONSE_AFTER_DELIVERY: { label: "No Response After Delivery", colorClass: "bg-blue-100 text-blue-700", icon: "⏳" },
};

export default async function QualitySignalsPage() {
  await requireAuth();

  const events = await prisma.taskQualityEvent.findMany({
    orderBy: { created_at: "desc" },
    take: 300,
    select: {
      id: true,
      basecamp_thread_id: true,
      comment_author: true,
      event_type: true,
      matched_keywords: true,
      snippet: true,
      created_at: true,
    },
  });

  // Summary counts by event_type
  const counts: Record<string, number> = {};
  const last7Days = new Date();
  last7Days.setDate(last7Days.getDate() - 7);
  const recentCounts: Record<string, number> = {};

  for (const e of events) {
    counts[e.event_type] = (counts[e.event_type] ?? 0) + 1;
    if (new Date(e.created_at) >= last7Days) {
      recentCounts[e.event_type] = (recentCounts[e.event_type] ?? 0) + 1;
    }
  }

  function EventBadge({ type }: { type: string }) {
    const meta = EVENT_TYPE_META[type] ?? { label: type, colorClass: "bg-gray-100 text-gray-600", icon: "•" };
    return (
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.colorClass}`}>
        {meta.icon} {meta.label}
      </span>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-6 h-6 text-amber-500" />
        <h1 className="text-2xl font-bold text-gray-900">Quality Signals</h1>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {Object.entries(EVENT_TYPE_META).map(([type, meta]) => (
          <div key={type} className="bg-white rounded-lg border shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xl">{meta.icon}</span>
              <span className="text-xs text-gray-400">last 7d: {recentCounts[type] ?? 0}</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{counts[type] ?? 0}</p>
            <p className="text-xs text-gray-500 mt-0.5">{meta.label}</p>
          </div>
        ))}
      </div>

      {/* Events table */}
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Signal Log</h2>
          <span className="text-xs text-gray-400">{events.length} events</span>
        </div>

        {events.length === 0 ? (
          <p className="px-4 py-10 text-center text-gray-400">No quality signals detected</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {events.map((e) => {
              const keywords = Array.isArray(e.matched_keywords) ? (e.matched_keywords as string[]) : [];
              return (
                <div key={e.id} className="px-4 py-3 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <EventBadge type={e.event_type} />
                        {e.comment_author && (
                          <span className="text-xs text-gray-500 font-medium">{e.comment_author}</span>
                        )}
                      </div>
                      {e.snippet && (
                        <p className="text-sm text-gray-700 italic line-clamp-2">
                          &ldquo;{e.snippet}&rdquo;
                        </p>
                      )}
                      {keywords.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {keywords.slice(0, 5).map((kw: string) => (
                            <span key={kw} className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                              {kw}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-gray-400 font-mono truncate">
                        Thread: {e.basecamp_thread_id}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">
                      {new Date(e.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
