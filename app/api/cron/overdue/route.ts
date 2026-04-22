/**
 * app/api/cron/overdue/route.ts
 * Overdue nudge monitor — runs every 15 minutes.
 * Finds BasecampTodos with no update for 24h+ and DMs the assigned VA.
 * Replaces Celery task: app.workers.run_overdue_monitor
 */
import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-guard";
import { prisma } from "@/lib/prisma";
import { sendDM } from "@/lib/slack";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stale = await prisma.basecampTodo.findMany({
    where: {
      completed: false,
      due_on: { not: null, lt: new Date() },
      updated_at: { lt: cutoff },
      assignee_id: { not: null },
    },
    take: 100,
    orderBy: { due_on: "asc" },
    select: { title: true, assignee_id: true, due_on: true },
  });

  let nudged = 0;
  for (const todo of stale) {
    if (!todo.assignee_id) continue;

    const va = await prisma.va.findFirst({
      where: { basecamp_person_id: todo.assignee_id, slack_user_id: { not: null } },
      select: { slack_user_id: true },
    });
    if (!va?.slack_user_id) continue;

    await sendDM(
      va.slack_user_id,
      `*Overdue reminder*: "${todo.title ?? "Task"}" was due ${todo.due_on?.toDateString() ?? "recently"} and has had no activity in 24+ hours. Please update Basecamp.`
    ).catch(() => null);
    nudged++;
  }

  return NextResponse.json({ checked: stale.length, nudged });
}