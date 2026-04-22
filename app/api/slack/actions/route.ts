/**
 * POST /api/slack/actions
 * Slack interactive components (button clicks, select menus).
 * Mirrors app/slack_actions.py :: handle_interaction()
 *
 * Action IDs handled:
 *   job_board_interested  — VA clicks "I'm Interested" on a job board post
 *   job_board_select_va   — AM selects a VA for a task
 */
import { NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack";
import { prisma } from "@/lib/prisma";
import { postMessage } from "@/lib/slack";

export const runtime = "nodejs";
export const maxDuration = 30;

interface SlackAction {
  action_id: string;
  value?: string;
  selected_option?: { value: string };
  block_id?: string;
}

interface SlackInteractionPayload {
  type: string;
  user: { id: string; username: string };
  actions: SlackAction[];
  message?: { ts: string };
  channel?: { id: string };
}

export async function POST(req: Request) {
  const cloned = req.clone();
  const isValid = await verifySlackSignature(cloned);
  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const form = await req.formData();
  const payloadStr = form.get("payload");
  if (typeof payloadStr !== "string") {
    return NextResponse.json({ error: "Missing payload" }, { status: 400 });
  }

  let payload: SlackInteractionPayload;
  try {
    payload = JSON.parse(payloadStr) as SlackInteractionPayload;
  } catch {
    return NextResponse.json({ error: "Invalid payload JSON" }, { status: 400 });
  }

  const slackUserId = payload.user.id;
  const action = payload.actions?.[0];
  if (!action) return NextResponse.json({ ok: true });

  switch (action.action_id) {
    case "job_board_interested": {
      const todoId = action.value ?? "";

      await prisma.jobBoardCandidate.create({
        data: {
          todo_id: todoId,
          slack_user_id: slackUserId,
          source: "slack_interested",
          status: "active",
        },
      }).catch(() => null);

      if (payload.channel?.id && payload.message?.ts) {
        await postMessage({
          channel: payload.channel.id,
          text: `<@${slackUserId}> marked as interested.`,
          thread_ts: payload.message.ts,
        }).catch(() => null);
      }

      return NextResponse.json({ text: "Noted! You've been added as interested." });
    }

    case "job_board_select_va": {
      const value = action.selected_option?.value ?? action.value ?? "";
      const [todoId, selectedVaSlackId] = value.split(":");

      await prisma.jobBoardPost.updateMany({
        where: { todo_id: todoId },
        data: {
          selected_slack_user_id: selectedVaSlackId,
          status: "assigned",
          assigned_at: new Date(),
          assigned_by_slack_user_id: slackUserId,
        },
      });

      return NextResponse.json({ text: `<@${selectedVaSlackId}> has been assigned.` });
    }

    default:
      return NextResponse.json({ ok: true });
  }
}