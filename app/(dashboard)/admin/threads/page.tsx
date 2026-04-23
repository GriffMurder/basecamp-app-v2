/**
 * app/(dashboard)/admin/threads/page.tsx
 *
 * Thread Activity monitor — shows BasecampThreadActivity rows with:
 *  - Response-time SLA status (15m / 30m / 60m / 90m alerts)
 *  - Hygiene DM pipeline state
 *  - Pending human follow-up flag
 *  - Last customer + last TB reply timestamps
 *
 * Filterable by: all | pending_followup | hygiene_active | unresolved | resolved
 */
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { formatDistanceToNow, differenceInMinutes } from "date-fns";
import {
  MessageSquare, AlertTriangle, CheckCircle, Clock, ShieldAlert, ExternalLink,
} from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

const HYGIENE_STATUS_META: Record<string, { label: string; cls: string }> = {
  pending:   { label: "Pending",   cls: "bg-gray-100 text-gray-600" },
  sent:      { label: "DM Sent",   cls: "bg-blue-100 text-blue-700" },
  completed: { label: "Resolved",  cls: "bg-emerald-100 text-emerald-700" },
  escalated: { label: "Escalated", cls: "bg-red-100 text-red-700" },
  suppressed:{ label: "Suppressed",cls: "bg-gray-100 text-gray-400" },
};

function HygieneBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const meta = HYGIENE_STATUS_META[status] ?? { label: status, cls: "bg-gray-100 text-gray-600" };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function SlaBar({ thread }: {
  thread: {
    last_customer_at: Date | null;
    last_tb_reply_at: Date | null;
    alerted_at_15m: Date | null;
    ack_posted_at_30m: Date | null;
    ops_posted_at_90m: Date | null;
    resolved_at: Date | null;
    pending_human_followup: boolean | null;
  }
}) {
  if (thread.resolved_at) {
    return <span className="text-xs text-emerald-600 font-medium flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Resolved</span>;
  }
  if (!thread.last_customer_at) return <span className="text-xs text-gray-400">—</span>;

  const now = new Date();
  const ageMin = differenceInMinutes(now, thread.last_customer_at);
  const hasReply = !!thread.last_tb_reply_at && thread.last_tb_reply_at > thread.last_customer_at;

  if (hasReply) {
    const replyMin = differenceInMinutes(thread.last_tb_reply_at!, thread.last_customer_at);
    return (
      <span className={`text-xs font-medium ${replyMin <= 15 ? "text-emerald-600" : replyMin <= 30 ? "text-amber-600" : "text-red-600"}`}>
        Replied {replyMin}m
      </span>
    );
  }

  if (ageMin >= 90) return <span className="text-xs font-semibold text-red-700 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {ageMin}m no reply</span>;
  if (ageMin >= 30) return <span className="text-xs font-semibold text-red-600">{ageMin}m — ops alerted</span>;
  if (ageMin >= 15) return <span className="text-xs font-medium text-amber-600">{ageMin}m — 15m alert</span>;
  return <span className="text-xs text-gray-500">{ageMin}m waiting</span>;
}

export default async function ThreadsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  await requireAdmin();
  const { filter = "unresolved", page: pageStr = "1" } = await searchParams;
  const page = Math.max(1, parseInt(pageStr));
  const pageSize = 60;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};
  if (filter === "pending_followup") {
    where.pending_human_followup = true;
    where.resolved_at = null;
  } else if (filter === "hygiene_active") {
    where.hygiene_dm_status = { in: ["pending", "sent", "escalated"] };
    where.resolved_at = null;
  } else if (filter === "unresolved") {
    where.resolved_at = null;
  } else if (filter === "resolved") {
    where.resolved_at = { not: null };
  }
  // "all" = no where filter

  const [threads, total, kpis] = await Promise.all([
    prisma.basecampThreadActivity.findMany({
      where,
      orderBy: { last_customer_at: "desc" },
      take: pageSize,
      skip,
      select: {
        id: true,
        thread_url: true,
        assigned_va_name: true,
        last_customer_at: true,
        last_customer_author: true,
        last_customer_text: true,
        last_tb_reply_at: true,
        pending_human_followup: true,
        resolved_at: true,
        resolved_by: true,
        hygiene_dm_status: true,
        hygiene_dm_count: true,
        hygiene_dm_last_sent_at: true,
        alerted_at_15m: true,
        ack_posted_at_30m: true,
        ops_posted_at_90m: true,
        nudge_stage: true,
        basecamp_project_id: true,
        basecamp_todo_id: true,
        org_id: true,
      },
    }),
    prisma.basecampThreadActivity.count({ where }),
    Promise.all([
      prisma.basecampThreadActivity.count({ where: { resolved_at: null } }),
      prisma.basecampThreadActivity.count({ where: { pending_human_followup: true, resolved_at: null } }),
      prisma.basecampThreadActivity.count({ where: { hygiene_dm_status: { in: ["sent", "escalated"] }, resolved_at: null } }),
      prisma.basecampThreadActivity.count({ where: { ops_posted_at_90m: { not: null }, resolved_at: null } }),
    ]).then(([unresolved, pendingFollowup, hygieneActive, escalated90m]) => ({
      unresolved, pendingFollowup, hygieneActive, escalated90m,
    })),
  ]);

  const totalPages = Math.ceil(total / pageSize);

  const FILTERS = [
    { key: "unresolved", label: "Unresolved" },
    { key: "pending_followup", label: "Pending Follow-up" },
    { key: "hygiene_active", label: "Hygiene Active" },
    { key: "resolved", label: "Resolved" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center gap-2">
        <MessageSquare className="w-6 h-6 text-blue-500" />
        <h1 className="text-2xl font-bold text-gray-900">Thread Activity Monitor</h1>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Unresolved" value={kpis.unresolved} variant={kpis.unresolved > 10 ? "danger" : "default"} />
        <KpiCard label="Pending Follow-up" value={kpis.pendingFollowup} variant={kpis.pendingFollowup > 0 ? "warning" : "default"} />
        <KpiCard label="Hygiene Active" value={kpis.hygieneActive} variant={kpis.hygieneActive > 0 ? "warning" : "default"} />
        <KpiCard label="90m+ No Reply" value={kpis.escalated90m} variant={kpis.escalated90m > 0 ? "danger" : "success"} />
      </div>

      {/* Alerts */}
      {kpis.escalated90m > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
          <span className="font-semibold">{kpis.escalated90m} thread{kpis.escalated90m !== 1 ? "s" : ""}</span>
          <span>have gone 90+ minutes without a TB reply — ops escalation triggered.</span>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(({ key, label }) => (
          <Link
            key={key}
            href={`/admin/threads?filter=${key}`}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              filter === key
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {label}
          </Link>
        ))}
        <span className="ml-auto text-xs text-gray-400 self-center">{total} records</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-gray-50 border-b">
              <tr>
                {["Thread", "Assigned VA", "Last Customer", "SLA Status", "Hygiene", "Follow-up", "Actions"].map((h) => (
                  <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {threads.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                    No threads match this filter.
                  </td>
                </tr>
              )}
              {threads.map((t) => (
                <tr key={t.id} className={`hover:bg-gray-50 ${t.pending_human_followup ? "bg-amber-50 hover:bg-amber-100" : ""}`}>
                  {/* Thread URL / ID */}
                  <td className="px-3 py-2.5 max-w-[200px]">
                    {t.thread_url ? (
                      <a
                        href={t.thread_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline flex items-center gap-1 truncate"
                      >
                        <ExternalLink className="w-3 h-3 shrink-0" />
                        <span className="truncate">{t.basecamp_todo_id ?? t.thread_url.split("/").at(-1) ?? "Thread"}</span>
                      </a>
                    ) : (
                      <span className="text-xs text-gray-400 font-mono">#{t.id}</span>
                    )}
                    {t.last_customer_text && (
                      <p className="text-xs text-gray-400 truncate max-w-[180px] mt-0.5 italic">
                        "{t.last_customer_text.slice(0, 60)}{t.last_customer_text.length > 60 ? "…" : ""}"
                      </p>
                    )}
                  </td>

                  {/* Assigned VA */}
                  <td className="px-3 py-2.5 text-xs text-gray-700">
                    {t.assigned_va_name ?? <span className="text-gray-400 italic">Unassigned</span>}
                  </td>

                  {/* Last customer */}
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                    {t.last_customer_at ? (
                      <div>
                        <p className="text-gray-700 font-medium">{t.last_customer_author ?? "Customer"}</p>
                        <p className="text-gray-400">{formatDistanceToNow(new Date(t.last_customer_at), { addSuffix: true })}</p>
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>

                  {/* SLA status */}
                  <td className="px-3 py-2.5">
                    <SlaBar thread={{
                      last_customer_at: t.last_customer_at,
                      last_tb_reply_at: t.last_tb_reply_at,
                      alerted_at_15m: t.alerted_at_15m,
                      ack_posted_at_30m: t.ack_posted_at_30m,
                      ops_posted_at_90m: t.ops_posted_at_90m,
                      resolved_at: t.resolved_at,
                      pending_human_followup: t.pending_human_followup,
                    }} />
                  </td>

                  {/* Hygiene DM */}
                  <td className="px-3 py-2.5">
                    <HygieneBadge status={t.hygiene_dm_status} />
                    {t.hygiene_dm_count != null && t.hygiene_dm_count > 0 && (
                      <span className="ml-1 text-xs text-gray-400">×{t.hygiene_dm_count}</span>
                    )}
                  </td>

                  {/* Follow-up */}
                  <td className="px-3 py-2.5">
                    {t.pending_human_followup ? (
                      <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                        <Clock className="w-3 h-3" /> Needed
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-3 py-2.5">
                    {t.resolved_at ? (
                      <span className="text-xs text-emerald-600 flex items-center gap-0.5">
                        <CheckCircle className="w-3 h-3" />
                        {t.resolved_by ?? "Resolved"}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex gap-2 justify-center">
          {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={`/admin/threads?filter=${filter}&page=${p}`}
              className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                p === page ? "bg-blue-600 text-white border-blue-600" : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}