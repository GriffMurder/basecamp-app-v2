import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  User,
  Clock,
  CheckCircle,
  AlertCircle,
  GitBranch,
} from "lucide-react";

export const dynamic = "force-dynamic";

function fmt(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d.toString()).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function hoursAgo(d: Date | null | undefined): string {
  if (!d) return "";
  const h = (Date.now() - new Date(d.toString()).getTime()) / (1000 * 60 * 60);
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 24) return `${h.toFixed(1)}h ago`;
  return `${(h / 24).toFixed(1)}d ago`;
}

function levelColor(level: string) {
  if (level === "founder") return "danger";
  if (level === "manager") return "warning";
  return "default";
}

function statusColor(status: string) {
  if (status === "resolved") return "success";
  if (status === "escalated") return "danger";
  if (status === "open") return "warning";
  return "muted";
}

export default async function EscalationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;

  // Load the intervention + related records
  const intv = await prisma.intervention.findUnique({
    where: { id: BigInt(id) },
  });

  if (!intv) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <Link href="/escalations" className="text-sm text-blue-600 hover:underline flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back to Escalations
        </Link>
        <div className="bg-red-50 border border-red-200 rounded-lg p-8 text-center text-red-600">
          Escalation #{id} not found.
        </div>
      </div>
    );
  }

  const [customer, relatedTodo, siblingInterventions] = await Promise.allSettled([
    intv.customer_id
      ? prisma.customer.findUnique({
          where: { id: intv.customer_id },
          select: { id: true, name: true, effective_tier: true },
        })
      : Promise.resolve(null),
    intv.todo_id
      ? prisma.basecampTodo.findFirst({
          where: { basecamp_todo_id: intv.todo_id },
          select: { id: true, title: true, completed: true, lifecycle_state: true, due_on: true },
        })
      : Promise.resolve(null),
    // Sibling/child interventions on the same todo or customer
    prisma.intervention.findMany({
      where: {
        id: { not: BigInt(id) },
        OR: [
          intv.todo_id ? { todo_id: intv.todo_id } : {},
          intv.customer_id ? { customer_id: intv.customer_id } : {},
        ].filter((f) => Object.keys(f).length > 0),
      },
      select: {
        id: true,
        level: true,
        reason: true,
        status: true,
        created_at: true,
        sent_at: true,
      },
      orderBy: { created_at: "desc" },
      take: 10,
    }),
  ]);

  const cust = customer.status === "fulfilled" ? customer.value : null;
  const todo = relatedTodo.status === "fulfilled" ? relatedTodo.value : null;
  const siblings = siblingInterventions.status === "fulfilled" ? siblingInterventions.value : [];

  const sentAt = intv.sent_at ? new Date(intv.sent_at.toString()) : null;
  const resolvedAt = intv.resolved_at ? new Date(intv.resolved_at.toString()) : null;
  const slaBreachedAt = intv.sla_breached_at ? new Date(intv.sla_breached_at.toString()) : null;
  const slaDueAt = intv.sla_due_at ? new Date(intv.sla_due_at.toString()) : null;
  const createdAt = new Date(intv.created_at.toString());

  // Compute duration open
  const endTime = resolvedAt ?? new Date();
  const durationH = (endTime.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
  const durationLabel =
    durationH < 1
      ? `${Math.round(durationH * 60)} minutes`
      : durationH < 48
      ? `${durationH.toFixed(1)} hours`
      : `${(durationH / 24).toFixed(1)} days`;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Nav */}
      <Link
        href="/escalations"
        className="text-sm text-blue-600 hover:underline flex items-center gap-1"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Escalations
      </Link>

      {/* Header */}
      <div className="bg-white rounded-lg border shadow-sm p-6 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              <h1 className="text-xl font-bold text-gray-900">
                Escalation #{id}
              </h1>
              <Badge variant={levelColor(intv.level) as "danger" | "warning" | "default"}>
                {intv.level.toUpperCase()}
              </Badge>
              <Badge variant={statusColor(intv.status) as "success" | "danger" | "warning" | "muted"}>
                {intv.status}
              </Badge>
              {slaBreachedAt && (
                <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
                  ⚠ SLA Breached
                </span>
              )}
            </div>
            <p className="text-sm text-gray-700">{intv.reason}</p>
          </div>
        </div>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Timeline */}
        <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-500" /> Timeline
          </h2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Created</dt>
              <dd className="text-gray-800 text-right">{fmt(createdAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Sent</dt>
              <dd className="text-gray-800 text-right">
                {sentAt ? `${fmt(sentAt)} (${hoursAgo(sentAt)})` : "—"}
              </dd>
            </div>
            {slaDueAt && (
              <div className="flex justify-between">
                <dt className="text-gray-500">SLA Due</dt>
                <dd
                  className={`text-right font-medium ${slaDueAt < new Date() ? "text-red-600" : "text-amber-600"}`}
                >
                  {fmt(slaDueAt)}
                </dd>
              </div>
            )}
            {slaBreachedAt && (
              <div className="flex justify-between">
                <dt className="text-gray-500">SLA Breached</dt>
                <dd className="text-right font-medium text-red-600">{fmt(slaBreachedAt)}</dd>
              </div>
            )}
            {resolvedAt && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Resolved</dt>
                <dd className="text-right text-emerald-600">{fmt(resolvedAt)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t pt-1.5 mt-1.5">
              <dt className="text-gray-500">Duration {resolvedAt ? "open" : "(so far)"}</dt>
              <dd className="text-gray-800 font-medium text-right">{durationLabel}</dd>
            </div>
          </dl>
        </div>

        {/* Context */}
        <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <User className="w-4 h-4 text-purple-500" /> Context
          </h2>
          <dl className="space-y-1.5 text-sm">
            {intv.target_person_id && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Target</dt>
                <dd className="text-gray-800 font-mono text-xs">{intv.target_person_id}</dd>
              </div>
            )}
            {cust && (
              <div className="flex justify-between items-center">
                <dt className="text-gray-500">Client</dt>
                <dd>
                  <Link
                    href={`/customers/${cust.id}`}
                    className="text-blue-600 hover:underline text-sm"
                  >
                    {cust.name}
                  </Link>
                  {cust.effective_tier && (
                    <span className="ml-1 text-xs text-gray-400">({cust.effective_tier})</span>
                  )}
                </dd>
              </div>
            )}
            {todo && (
              <div className="flex justify-between items-center">
                <dt className="text-gray-500">Task</dt>
                <dd>
                  <Link
                    href={`/todos/${todo.id}`}
                    className="text-blue-600 hover:underline text-sm truncate max-w-48 block text-right"
                  >
                    {todo.title ?? intv.todo_id}
                  </Link>
                </dd>
              </div>
            )}
            {intv.root_cause_category && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Root Cause</dt>
                <dd className="text-gray-800">{intv.root_cause_category}</dd>
              </div>
            )}
            {intv.resolution_kind && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Resolution</dt>
                <dd className="text-gray-800">{intv.resolution_kind}</dd>
              </div>
            )}
            {intv.parent_intervention_id && (
              <div className="flex justify-between items-center">
                <dt className="text-gray-500">Parent</dt>
                <dd>
                  <Link
                    href={`/escalations/${intv.parent_intervention_id}`}
                    className="text-blue-600 hover:underline text-sm"
                  >
                    #{intv.parent_intervention_id.toString()}
                  </Link>
                </dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      {/* Resolution note */}
      {intv.resolution_note && (
        <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-4 space-y-1">
          <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5" /> Resolution Note
          </p>
          <p className="text-sm text-emerald-800">{intv.resolution_note}</p>
        </div>
      )}

      {/* Slack ref */}
      {intv.slack_msg_ts && intv.slack_channel_id && (
        <div className="bg-purple-50 rounded-lg border border-purple-200 p-4">
          <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-1">
            Slack Thread
          </p>
          <p className="text-xs font-mono text-purple-600">
            channel: {intv.slack_channel_id} · ts: {intv.slack_msg_ts}
          </p>
        </div>
      )}

      {/* Related escalations */}
      {siblings.length > 0 && (
        <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-gray-500" />
            Related Escalations
          </h2>
          <div className="divide-y divide-gray-100">
            {siblings.map((s) => (
              <div key={s.id.toString()} className="flex items-center justify-between py-2 text-sm">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/escalations/${s.id}`}
                    className="text-blue-600 hover:underline font-medium"
                  >
                    #{s.id.toString()}
                  </Link>
                  <Badge variant={levelColor(s.level) as "danger" | "warning" | "default"}>
                    {s.level}
                  </Badge>
                  <span className="text-gray-500 truncate max-w-xs">{s.reason}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={statusColor(s.status) as "success" | "danger" | "warning" | "muted"}>
                    {s.status}
                  </Badge>
                  <span className="text-xs text-gray-400">{hoursAgo(s.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
