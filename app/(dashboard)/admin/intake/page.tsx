/**
 * app/(dashboard)/admin/intake/page.tsx
 *
 * Admin view of todos currently held in the intake gate state machine.
 * Shows all non-null, non-ready intake states grouped by state, plus
 * a button to manually reset (clear) the intake state for a given todo.
 */
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ClipboardList, RefreshCw, Clock, Hash } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { IntakeResetButton } from "./reset-button";

export const dynamic = "force-dynamic";

const STATE_LABELS: Record<string, string> = {
  awaiting_placeholder_confirmation: "Awaiting Placeholder Confirmation",
  awaiting_details:                  "Awaiting Details",
  placeholder_confirmed:             "Placeholder Confirmed",
  ready:                             "Ready",
};

const STATE_COLORS: Record<string, string> = {
  awaiting_placeholder_confirmation: "bg-amber-100 text-amber-700 border-amber-200",
  awaiting_details:                  "bg-blue-100 text-blue-700 border-blue-200",
  placeholder_confirmed:             "bg-gray-100 text-gray-600 border-gray-200",
  ready:                             "bg-emerald-100 text-emerald-700 border-emerald-200",
};

export default async function AdminIntakePage() {
  await requireAdmin();

  const todos = await prisma.basecampTodo.findMany({
    where: {
      intake_state: { not: null },
      completed: false,
    },
    orderBy: [{ intake_state: "asc" }, { intake_last_ping_at: "desc" }],
    select: {
      id: true,
      title: true,
      basecamp_project_id: true,
      project_name: true,
      intake_state: true,
      intake_ping_count: true,
      intake_last_ping_at: true,
      intake_comment_id: true,
      due_on: true,
    },
  });

  const byState = todos.reduce<Record<string, typeof todos>>((acc, todo) => {
    const state = todo.intake_state ?? "unknown";
    if (!acc[state]) acc[state] = [];
    acc[state].push(todo);
    return acc;
  }, {});

  const stateOrder = [
    "awaiting_placeholder_confirmation",
    "awaiting_details",
    "placeholder_confirmed",
    "ready",
  ];

  const orderedStates = [
    ...stateOrder.filter((s) => byState[s]?.length),
    ...Object.keys(byState).filter((s) => !stateOrder.includes(s)),
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-50 rounded-lg border border-amber-200">
            <ClipboardList className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Intake Gate Monitor</h1>
            <p className="text-sm text-gray-500">
              {todos.length} todo{todos.length !== 1 ? "s" : ""} in intake gate states
            </p>
          </div>
        </div>
      </div>

      {todos.length === 0 && (
        <div className="bg-white rounded-lg border p-10 text-center text-gray-400">
          <ClipboardList className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No todos in intake gate states.</p>
        </div>
      )}

      {orderedStates.map((state) => {
        const items = byState[state] ?? [];
        const colorCls = STATE_COLORS[state] ?? "bg-gray-100 text-gray-600 border-gray-200";
        const label = STATE_LABELS[state] ?? state.replace(/_/g, " ");
        return (
          <div key={state} className="bg-white rounded-lg border shadow-sm overflow-hidden">
            <div className={`px-4 py-3 border-b flex items-center justify-between ${colorCls}`}>
              <h2 className="text-sm font-semibold">{label}</h2>
              <span className="text-xs font-medium">{items.length} todo{items.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="divide-y divide-gray-100">
              {items.map((todo) => (
                <div key={todo.id} className="px-4 py-3 flex items-start gap-4">
                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {todo.title ?? "(Untitled)"}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {todo.project_name ?? todo.basecamp_project_id ?? "—"}
                    </p>
                  </div>

                  {/* Ping count */}
                  <div className="flex items-center gap-1 text-xs text-gray-500 shrink-0">
                    <Hash className="w-3 h-3" />
                    <span>{todo.intake_ping_count ?? 0} ping{(todo.intake_ping_count ?? 0) !== 1 ? "s" : ""}</span>
                  </div>

                  {/* Last ping */}
                  <div className="flex items-center gap-1 text-xs text-gray-500 shrink-0 w-32">
                    <Clock className="w-3 h-3 shrink-0" />
                    <span>
                      {todo.intake_last_ping_at
                        ? new Date(todo.intake_last_ping_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        : "Never pinged"}
                    </span>
                  </div>

                  {/* Due date */}
                  <div className="text-xs text-gray-500 shrink-0 w-20">
                    {todo.due_on
                      ? new Date(todo.due_on).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      : "No due date"}
                  </div>

                  {/* Reset button */}
                  {state !== "ready" && (
                    <IntakeResetButton todoId={todo.id} />
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}