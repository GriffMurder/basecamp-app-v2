import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { CheckSquare, Clock, AlertCircle } from "lucide-react";
import { Suspense } from "react";
import { TodoSearchBar } from "./todo-search-bar";

export const dynamic = "force-dynamic";

export default async function TodosPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; completed?: string; overdue?: string; q?: string }>;
}) {
  await requireAuth();

  const { page: pageStr, completed, overdue, q } = await searchParams;
  const page = Math.max(1, parseInt(pageStr ?? "1"));
  const pageSize = 50;
  const showCompleted = completed === "1";
  const overdueOnly = overdue === "1";
  const searchQuery = q?.trim() ?? "";
  const now = new Date();

  const where = {
    ...(showCompleted ? {} : { completed: false }),
    ...(overdueOnly ? { due_on: { lt: now }, completed: false } : {}),
    ...(searchQuery ? { title: { contains: searchQuery, mode: "insensitive" as const } } : {}),
  };

  const [todos, total] = await Promise.all([
    prisma.basecampTodo.findMany({
      where,
      orderBy: [{ due_on: "asc" }, { updated_at: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        basecamp_todo_id: true,
        basecamp_project_id: true,
        assignee_name: true,
        assignee_id: true,
        completed: true,
        due_on: true,
        updated_at: true,
        lifecycle_state: true,
        title: true,
      },
    }),
    prisma.basecampTodo.count({ where }),
  ]);

  const totalPages = Math.ceil(total / pageSize);

  function formatDate(d: Date | null) {
    if (!d) return "—";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function isOverdue(todo: typeof todos[0]) {
    return !todo.completed && todo.due_on && todo.due_on < now;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <CheckSquare className="w-6 h-6 text-blue-500" />
          Tasks
        </h1>
        <div className="flex items-center gap-3">
          <Suspense>
            <TodoSearchBar defaultValue={searchQuery} />
          </Suspense>
          <span className="text-sm text-gray-500">{total.toLocaleString()} total</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Link
          href="/todos"
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${!showCompleted && !overdueOnly && !searchQuery ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}
        >
          Open
        </Link>
        <Link
          href="/todos?overdue=1"
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${overdueOnly ? "bg-red-600 text-white border-red-600" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}
        >
          Overdue
        </Link>
        <Link
          href="/todos?completed=1"
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${showCompleted ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}
        >
          All (incl. completed)
        </Link>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Task</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Assignee</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Due</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">State</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {todos.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                  No tasks found
                </td>
              </tr>
            )}
            {todos.map((t) => {
              const overdue = isOverdue(t);
              return (
                <tr key={t.id} className={overdue ? "bg-red-50" : "hover:bg-gray-50"}>
                  <td className="px-4 py-2.5 max-w-xs">
                    <Link href={`/todos/${t.id}`} className="hover:underline">
                      <p className={`font-medium truncate ${t.completed ? "line-through text-gray-400" : "text-gray-900 hover:text-blue-600"}`}>
                        {t.title ?? t.basecamp_todo_id}
                      </p>
                    </Link>
                    <p className="text-xs text-gray-400 truncate">BC: {t.basecamp_project_id}</p>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{t.assignee_name ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    {overdue ? (
                      <span className="flex items-center gap-1 text-red-600 font-medium">
                        <AlertCircle className="w-3 h-3" />
                        {formatDate(t.due_on)}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-gray-600">
                        {t.due_on && <Clock className="w-3 h-3" />}
                        {formatDate(t.due_on)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant="muted">{t.lifecycle_state}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant={t.completed ? "success" : overdue ? "danger" : "default"}>
                      {t.completed ? "Done" : overdue ? "Overdue" : "Open"}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={`/todos?page=${page - 1}${overdueOnly ? "&overdue=1" : ""}${showCompleted ? "&completed=1" : ""}${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}`}
                className="px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50">
                ← Prev
              </Link>
            )}
            {page < totalPages && (
              <Link href={`/todos?page=${page + 1}${overdueOnly ? "&overdue=1" : ""}${showCompleted ? "&completed=1" : ""}${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}`}
                className="px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50">
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}