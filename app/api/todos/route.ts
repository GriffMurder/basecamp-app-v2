/**
 * GET  /api/todos — list BasecampTodos with filters
 * POST /api/todos — create a placeholder todo (for internal use)
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET(req: Request) {
  await requireAuth();
  const url = new URL(req.url);
  const projectId = url.searchParams.get("project_id");
  const assigneeId = url.searchParams.get("assignee_id");
  const completed = url.searchParams.get("completed");
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("page_size") ?? "50")));

  const where: Record<string, unknown> = {};
  if (projectId) where.basecamp_project_id = projectId;
  if (assigneeId) where.assignee_id = assigneeId;
  if (completed !== null && completed !== undefined) where.completed = completed === "true";

  const [todos, total] = await Promise.all([
    prisma.basecampTodo.findMany({
      where,
      take: pageSize,
      skip: (page - 1) * pageSize,
      orderBy: { due_on: "asc" },
      select: {
        id: true,
        basecamp_todo_id: true,
        basecamp_project_id: true,
        title: true,
        description: true,
        assignee_id: true,
        assignee_name: true,
        due_on: true,
        completed: true,
        completed_at: true,
        workflow_state: true,
        created_at: true,
        updated_at: true,
      },
    }),
    prisma.basecampTodo.count({ where }),
  ]);

  return NextResponse.json({ ok: true, todos, total, page, page_size: pageSize });
}

const createSchema = z.object({
  basecamp_todo_id: z.string().min(1),
  basecamp_project_id: z.string().min(1),
  basecamp_todolist_id: z.string().default(""),
  title: z.string().min(1),
  description: z.string().optional(),
  assignee_id: z.string().optional(),
  assignee_name: z.string().optional(),
  due_on: z.string().optional(),
});

export async function POST(req: Request) {
  await requireAuth();
  const body = await req.json() as unknown;
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const todo = await prisma.basecampTodo.upsert({
    where: { basecamp_todo_id: parsed.data.basecamp_todo_id },
    create: {
      ...parsed.data,
      due_on: parsed.data.due_on ? new Date(parsed.data.due_on) : null,
    },
    update: {
      title: parsed.data.title,
      description: parsed.data.description,
      assignee_id: parsed.data.assignee_id,
      assignee_name: parsed.data.assignee_name,
      due_on: parsed.data.due_on ? new Date(parsed.data.due_on) : null,
    },
  });
  return NextResponse.json({ ok: true, todo }, { status: 201 });
}