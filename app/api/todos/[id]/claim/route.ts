/**
 * POST /api/todos/[id]/claim
 *
 * Allows the current dashboard user to claim a Basecamp task:
 *   1. Resolves the calling user's VA record (by email).
 *   2. Updates assignee_name on the BasecampTodo row.
 *   3. Calls generateClientUpdate() to produce a friendly client message.
 *   4. Posts the message as a Basecamp comment (if env vars present).
 *   5. Returns { ok, message } — the UI can preview the posted text.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateClientUpdate } from "@/lib/ai-client-updates";
import { postComment } from "@/lib/basecamp";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  const { id: rawId } = await params;
  const todoId = parseInt(rawId, 10);
  if (isNaN(todoId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const todo = await prisma.basecampTodo.findUnique({ where: { id: todoId } });
  if (!todo) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (todo.completed) {
    return NextResponse.json({ error: "Task is already completed" }, { status: 400 });
  }

  // Resolve the calling user's display name via Va record
  const userEmail = (session.user as { email?: string }).email ?? "";
  const va = userEmail
    ? await prisma.va.findFirst({ where: { email: userEmail, active: true } })
    : null;
  const claimerName = va?.display_name ?? (session.user as { name?: string }).name ?? "Your TaskBullet VA";

  // Update the todo assignee
  const updated = await prisma.basecampTodo.update({
    where: { id: todoId },
    data: {
      assignee_name: claimerName,
      ...(va?.basecamp_person_id ? { assignee_id: String(va.basecamp_person_id) } : {}),
    },
  });

  // Generate client update message
  const dueDate = updated.due_on
    ? new Date(updated.due_on).toLocaleDateString("en-US", { month: "long", day: "numeric" })
    : null;

  const message = await generateClientUpdate({
    claimerName,
    todoTitle: updated.title ?? "your task",
    todoDescription: updated.description,
    dueDate,
  });

  // Post to Basecamp as a comment (non-fatal)
  let postedToBasecamp = false;
  if (todo.basecamp_project_id && todo.basecamp_todo_id) {
    try {
      const projectId = parseInt(todo.basecamp_project_id, 10);
      const bcTodoId = parseInt(todo.basecamp_todo_id, 10);
      if (!isNaN(projectId) && !isNaN(bcTodoId)) {
        await postComment(projectId, bcTodoId, message);
        postedToBasecamp = true;
      }
    } catch {
      // Non-fatal — still return the message even if Basecamp post fails
    }
  }

  return NextResponse.json({
    ok: true,
    message,
    claimer: claimerName,
    posted_to_basecamp: postedToBasecamp,
  });
}