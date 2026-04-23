import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { FileText, CheckCircle, Clock, AlertCircle } from "lucide-react";
import Link from "next/link";
import ApproveButton from "./approve-button";

export const dynamic = "force-dynamic";

function statusVariant(
  status: string
): "success" | "default" | "warning" | "danger" | "muted" {
  if (status === "posted") return "success";
  if (status === "approved") return "default";
  if (status === "drafted") return "warning";
  if (status === "failed") return "danger";
  return "muted";
}

interface ReportJson {
  what_was_done?: string[];
  where_to_find_it?: string;
  quality_checks?: string[];
  next_steps?: string[];
  blockers?: string[];
}

function ReportSection({ report }: { report: ReportJson }) {
  return (
    <div className="space-y-5">
      {report.what_was_done && report.what_was_done.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">
            What Was Done
          </h3>
          <ul className="space-y-1">
            {report.what_was_done.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-700">
                <span className="text-emerald-500 mt-0.5">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.where_to_find_it && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">
            Where to Find It
          </h3>
          <p className="text-sm text-gray-700 bg-gray-50 rounded px-3 py-2">
            {report.where_to_find_it}
          </p>
        </div>
      )}

      {report.quality_checks && report.quality_checks.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">
            Quality Checks
          </h3>
          <ul className="space-y-1">
            {report.quality_checks.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-700">
                <CheckCircle className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.next_steps && report.next_steps.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">
            Next Steps
          </h3>
          <ul className="space-y-1">
            {report.next_steps.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-700">
                <span className="text-blue-400 mt-0.5">→</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.blockers && report.blockers.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">
            Blockers / Gaps
          </h3>
          <ul className="space-y-1">
            {report.blockers.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm text-amber-700">
                <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;

  const report = await prisma.taskCompletionReport.findUnique({
    where: { id },
  });

  if (!report) notFound();

  const todo = await prisma.basecampTodo.findFirst({
    where: { basecamp_todo_id: report.basecamp_thread_id },
    select: { title: true, assignee_name: true, completed_at: true, urls: true },
  });

  const draftJson = (report.draft_report ?? {}) as ReportJson;
  const approvedJson = (report.approved_report ?? null) as ReportJson | null;
  const activeReport = approvedJson ?? draftJson;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-5 h-5 text-blue-500" />
            <h1 className="text-xl font-bold text-gray-900">
              Completion Report
            </h1>
            <Badge variant={statusVariant(report.status)}>{report.status}</Badge>
          </div>
          <p className="text-sm text-gray-500 font-mono truncate max-w-md">
            Thread: {report.basecamp_thread_id}
          </p>
          {todo?.title && (
            <p className="text-sm text-gray-700 mt-1 font-medium">{todo.title}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/reports"
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
          >
            ← Back
          </Link>
          {report.status === "drafted" && (
            <ApproveButton reportId={report.id} />
          )}
        </div>
      </div>

      {/* Metadata */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-xs text-gray-500">Type</p>
          <p className="font-medium capitalize text-gray-800">{report.task_type}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Edits</p>
          <p className="font-medium text-gray-800">{report.edit_count}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Assignee</p>
          <p className="font-medium text-gray-800">{todo?.assignee_name ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Completed</p>
          <p className="font-medium text-gray-800">
            {(todo?.completed_at ?? report.completed_at)
              ? new Date((todo?.completed_at ?? report.completed_at)!).toLocaleDateString()
              : "—"}
          </p>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-gray-400" />
          Timeline
        </h2>
        <div className="space-y-2 text-sm">
          {[
            { label: "Created", date: report.created_at },
            { label: "Approved", date: report.approved_at },
            { label: "Posted", date: report.posted_at },
          ].map(
            ({ label, date }) =>
              date && (
                <div key={label} className="flex justify-between text-gray-600">
                  <span>{label}</span>
                  <span className="text-gray-400 text-xs">
                    {new Date(date).toLocaleString()}
                  </span>
                </div>
              )
          )}
        </div>
      </div>

      {/* Error */}
      {report.error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          <strong>Error:</strong> {report.error}
        </div>
      )}

      {/* Active report (approved if exists, else draft) */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-sm font-semibold text-gray-700">
            {approvedJson ? "Approved Report" : "Draft Report"}
          </h2>
          {!approvedJson && (
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
              draft
            </span>
          )}
        </div>
        <ReportSection report={activeReport} />
      </div>

      {/* Show draft alongside approved if both exist */}
      {approvedJson && (
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-500 mb-4">Original Draft</h2>
          <ReportSection report={draftJson} />
        </div>
      )}

      {/* Basecamp link */}
      {todo?.urls && (
        <div className="text-sm">
          {(() => {
            const urls = todo.urls as Record<string, string> | null;
            const link = urls?.app ?? urls?.url ?? "";
            return link ? (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline"
              >
                View in Basecamp →
              </a>
            ) : null;
          })()}
        </div>
      )}
    </div>
  );
}
