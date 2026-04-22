/**
 * app/api/cron/sla/route.ts
 * SLA monitor — runs every 5 minutes.
 * Finds threads where the customer message is unanswered past SLA window.
 * Replaces Celery task: app.workers.run_sla_monitor
 */
import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-guard";
import { prisma } from "@/lib/prisma";
import { sendDM } from "@/lib/slack";

export const runtime = "nodejs";
export const maxDuration = 300;

const SLA_MINUTES = 30; // alert if no TB reply within 30 min of customer message

export async function GET(req: Request) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const slaThreshold = new Date(Date.now() - SLA_MINUTES * 60 * 1000);
  // Find threads with a recent customer message that still has no TB reply
  const threads = await prisma.basecampThreadActivity.findMany({
    where: {
      resolved_at: null,
      last_customer_at: { lt: slaThreshold },
      last_tb_reply_at: null,
      assigned_va_id: { not: null },
      alerted_at_15m: null, // not yet alerted
    },
    take: 50,
    orderBy: { last_customer_at: "asc" },
  });

  let alerted = 0;
  for (const thread of threads) {
    if (!thread.assigned_va_id) continue;

    const va = await prisma.va.findFirst({
      where: { basecamp_person_id: thread.assigned_va_id, slack_user_id: { not: null } },
      select: { slack_user_id: true },
    });

    if (va?.slack_user_id) {
      await sendDM(
        va.slack_user_id,
        `*SLA Alert*: A client message in "${thread.thread_url ?? "a Basecamp thread"}" has not been replied to in ${SLA_MINUTES} minutes. Please respond.`
      ).catch(() => null);
      alerted++;
    }

    // Mark as alerted
    await prisma.basecampThreadActivity.update({
      where: { id: thread.id },
      data: { alerted_at_15m: new Date() },
    });
  }

  return NextResponse.json({ checked: threads.length, alerted });
}