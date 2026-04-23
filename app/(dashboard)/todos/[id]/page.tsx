import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { AssignRecommender } from "./assign-recommender";
import { ClaimButton } from "./claim-button";
import { CheckSquare, ArrowLeft, Clock, Calendar, User, AlertCircle, ClipboardList, ShieldAlert } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function TodoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) notFound();

  const todo = await prisma.basecampTodo.findUnique({
    where: { id },
  });
  if (!todo) notFound();

  const now = new Date();
  const isOverdue = !todo.completed && todo.due_on && todo.due_on < now;

  // Fetch hygiene gate thread data
  const threadActivity = await prisma.basecampThreadActivity.findFirst({
    where: { basecamp_todo_id: todo.basecamp_todo_id },
    select: {
      hygiene_dm_status: true,
      hygiene_dm_count: true,
      hygiene_dm_last_sent_at: true,
      last_comment_author_is_internal: true,
      last_tb_reply_at: true,
    },
  });

  // Fetch related interventions
  const interventions = await prisma.intervention.findMany({
    where: {
      todo_id: id as unknown as string,
      status: "open",
    },
    orderBy: { created_at: "desc" },
    take: 5,
    select: {
      id: true, level: true, reason: true, status: true, created_at: true,
    },
  });

  // Fetch DIM findings for this todo
  const dimFindings = await prisma.taskIntegrityFinding.findMany({
    where: { todo_id: id, resolved_at: null },
    orderBy: { detected_at: "desc" },
    select: { id: true, finding_type: true, severity: true, detail: true, detected_at: true },
  });

  const LIFECYCLE_COLORS: Record<string, string> = {
    CREATED: "bg-gray-100 text-gray-600",
    IN_PROGRESS: "bg-blue-100 text-blue-700",
    PENDING_REVIEW: "bg-purple-100 text-purple-700",
    COMPLETION_SIGNAL_DETECTED: "bg-emerald-100 text-emerald-700",
    DONE: "bg-emerald-200 text-emerald-800",
  };

  const lifecycleColor =
    LIFECYCLE_COLORS[todo.lifecycle_state ?? "CREATED"] ?? "bg-gray-100 text-gray-600";

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Back link */}
      <Link href="/todos" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> Back to Tasks
      </Link>

      {/* Header card */}
      <div className="bg-white rounded-lg border shadow-sm p-5 space-y-3">
        <div className="flex items-start gap-3">
          <CheckSquare
            className={`w-5 h-5 shrink-0 mt-0.5 ${todo.completed ? "text-emerald-400" : isOverdue ? "text-red-400" : "text-blue-400"}`}
          />
          <div className="flex-1 min-w-0 space-y-1">
            <h1 className="text-lg font-bold text-gray-900 leading-tight">
              {todo.title ?? "(Untitled)"}
            </h1>
            {todo.description && (
              <p className="text-sm text-gray-500">{todo.description}</p>
            )}
          </div>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-2 text-xs text-gray-500 pt-1">
          {todo.lifecycle_state && (
            <span className={`px-2 py-0.5 rounded-full font-medium text-xs ${lifecycleColor}`}>
              {todo.lifecycle_state.replace(/_/g, " ")}
            </span>
          )}
          {todo.completed && (
            <Badge variant="success">Completed</Badge>
          )}
          {isOverdue && (
            <span className="flex items-center gap-1 text-red-500 font-medium">
              <AlertCircle className="w-3 h-3" /> Overdue
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          <div className="text-xs">
            <p className="text-gray-400 uppercase tracking-wide font-semibold mb-0.5">Assigned To</p>
            <div className="flex items-center gap-1 text-gray-700">
              <User className="w-3 h-3" />
              <span>{todo.assignee_name ?? "Unassigned"}</span>
            </div>
          </div>
          <div className="text-xs">
            <p className="text-gray-400 uppercase tracking-wide font-semibold mb-0.5">Due Date</p>
            <div className="flex items-center gap-1 text-gray-700">
              <Calendar className="w-3 h-3" />
              <span>
                {todo.due_on
                  ? new Date(todo.due_on).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : "—"}
              </span>
            </div>
          </div>
          <div className="text-xs">
            <p className="text-gray-400 uppercase tracking-wide font-semibold mb-0.5">Updated</p>
            <div className="flex items-center gap-1 text-gray-700">
              <Clock className="w-3 h-3" />
              <span>
                {todo.updated_at
                  ? new Date(todo.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  : "—"}
              </span>
            </div>
          </div>
          <div className="text-xs">
            <p className="text-gray-400 uppercase tracking-wide font-semibold mb-0.5">Project ID</p>
            <span className="font-mono text-gray-600 text-xs">
              {todo.basecamp_project_id ?? "—"}
            </span>
          </div>
        </div>
      </div>

      {/* VA Assignment Recommender */}
      {!todo.completed && (
        <div className="bg-white rounded-lg border shadow-sm p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Assign VA</h2>
          <AssignRecommender title={todo.title ?? ""} />
        </div>
      )}

      {/* Claim Task */}
      {!todo.completed && (
        <div className="bg-white rounded-lg border shadow-sm p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Claim Task</h2>
          <ClaimButton todoId={todo.id} />
        </div>
      )}

      {/* DIM Findings */}
      {dimFindings.length > 0 && (
        <div className="bg-white rounded-lg border border-amber-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
            <h2 className="text-sm font-semibold text-amber-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Integrity Findings ({dimFindings.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-100">
            {dimFindings.map((f) => (
              <div key={f.id} className="px-4 py-3 flex items-start gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  f.severity === "critical" ? "bg-red-100 text-red-700"
                  : f.severity === "warning" ? "bg-amber-100 text-amber-700"
                  : "bg-blue-100 text-blue-700"
                }`}>
                  {f.severity}
                </span>
                <div>
                  <p className="text-sm font-medium text-gray-800">{f.finding_type.replace(/_/g, " ")}</p>
                  {f.detail && <p className="text-xs text-gray-500 mt-0.5">{f.detail}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Open Interventions */}
      {interventions.length > 0 && (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Open Escalations ({interventions.length})</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {interventions.map((iv) => (
              <div key={String(iv.id)} className="px-4 py-3 flex items-center justify-between text-sm">
                <div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium mr-2 ${
                    iv.level === "founder" ? "bg-red-100 text-red-700"
                    : iv.level === "manager" ? "bg-amber-100 text-amber-700"
                    : "bg-blue-100 text-blue-700"
                  }`}>
                    {iv.level}
                  </span>
                  <span className="text-gray-700">{iv.reason}</span>
                </div>
                <span className="text-xs text-gray-400">
                  {new Date(iv.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Intake Gate State */}
      {todo.intake_state && (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-amber-500" />
            <h2 className="text-sm font-semibold text-gray-700">Intake Gate</h2>
          </div>
          <div className="px-4 py-3 grid grid-cols-3 gap-4 text-xs">
            <div>
              <p className="text-gray-400 uppercase tracking-wide font-semibold mb-1">State</p>
              <span className={`px-2 py-0.5 rounded-full font-medium ${
                todo.intake_state === "placeholder_confirmed" ? "bg-gray-100 text-gray-600"
                : todo.intake_state === "awaiting_details" ? "bg-blue-100 text-blue-700"
                : todo.intake_state === "awaiting_placeholder_confirmation" ? "bg-amber-100 text-amber-700"
                : "bg-emerald-100 text-emerald-700"
              }`}>
                {todo.intake_state.replace(/_/g, " ")}
              </span>
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide font-semibold mb-1">Pings</p>
              <span className="text-gray-700">{todo.intake_ping_count ?? 0}</span>
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide font-semibold mb-1">Last Ping</p>
              <span className="text-gray-700">
                {todo.intake_last_ping_at
                  ? new Date(todo.intake_last_ping_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  : "—"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Hygiene Gate State */}
      {threadActivity?.hygiene_dm_status && threadActivity.hygiene_dm_status !== "pending" && (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-purple-500" />
            <h2 className="text-sm font-semibold text-gray-700">Hygiene Gate</h2>
          </div>
          <div className="px-4 py-3 grid grid-cols-3 gap-4 text-xs">
            <div>
              <p className="text-gray-400 uppercase tracking-wide font-semibold mb-1">DM Status</p>
              <span className={`px-2 py-0.5 rounded-full font-medium ${
                threadActivity.hygiene_dm_status === "completed" ? "bg-emerald-100 text-emerald-700"
                : threadActivity.hygiene_dm_status === "escalated" ? "bg-red-100 text-red-700"
                : threadActivity.hygiene_dm_status === "suppressed" ? "bg-gray-100 text-gray-600"
                : "bg-purple-100 text-purple-700"
              }`}>
                {threadActivity.hygiene_dm_status}
              </span>
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide font-semibold mb-1">DMs Sent</p>
              <span className="text-gray-700">{threadActivity.hygiene_dm_count ?? 0}</span>
            </div>
            <div>
              <p className="text-gray-400 uppercase tracking-wide font-semibold mb-1">Last DM</p>
              <span className="text-gray-700">
                {threadActivity.hygiene_dm_last_sent_at
                  ? new Date(threadActivity.hygiene_dm_last_sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  : "—"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="flex items-center gap-3 text-sm text-gray-500">
        {todo.basecamp_todo_id && (
          <a
            href={`https://3.basecamp.com/${process.env.NEXT_PUBLIC_BASECAMP_ACCOUNT_ID ?? "3260428"}/buckets/${todo.basecamp_todolist_id ?? ""}/todos/${todo.basecamp_todo_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-blue-600"
          >
            Open in Basecamp ↗
          </a>
        )}
      </div>
    </div>
  );
}
