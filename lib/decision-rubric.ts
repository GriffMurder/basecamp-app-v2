/**
 * lib/decision-rubric.ts
 * ~~~~~~~~~~~~~~~~~~~~~~
 * Port of app/decision_rubric.py — deterministic thread-decision engine.
 *
 * Given a ThreadState snapshot, decide_actions() returns Actions:
 *   - do_reassure / reassure_reason → post an AI acknowledgement to the client
 *   - do_push / push_actions        → alert/escalate internally
 *
 * Pure logic — no I/O, no DB. Safe to use in Inngest steps or API routes.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface ThreadState {
  // Core timestamps
  last_customer_at?: Date | null;
  last_tb_reply_at?: Date | null;
  last_customer_comment_id?: string | null;

  // Assignment
  assigned_va_id?: string | null;
  assigned_va_slack_user_id?: string | null;

  // Nudge system
  nudge_started_at?: Date | null;
  nudge_ack_at?: Date | null;
  nudge_stage?: string | null;

  // AI ack idempotency
  last_ai_ack_customer_comment_id?: string | null;
  last_ai_ack_at?: Date | null;

  // Deadline / checkpoints
  due_at?: Date | null;
  followup_half_at?: Date | null;
  followup_final_third_at?: Date | null;
  followup_half_done?: boolean;
  followup_final_third_done?: boolean;

  // Task categorization
  task_type?: "reactive" | "deep_work" | null;

  // VA reliability
  va_reliability_score?: number | null;  // 0..100 or 0..1 (auto-normalised)
  va_missed_ack_rate?: number | null;    // 0..1

  // Availability
  va_is_clocked_in?: boolean | null;
  va_in_scheduled_block?: boolean | null;
}

export interface Actions {
  do_reassure: boolean;
  reassure_reason?: string;
  do_push: boolean;
  push_actions: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────

const REASSURE_MIN_SILENCE_MS   = 30 * 60 * 1000;          // 30 min
const AI_ACK_COOLDOWN_MS        = 4 * 60 * 60 * 1000;      // 4 h
const TOLERANCE_REACTIVE_MS     = 1 * 60 * 60 * 1000;      // 1 h
const TOLERANCE_DEEP_WORK_MS    = 4 * 60 * 60 * 1000;      // 4 h
const TOLERANCE_DEFAULT_MS      = 2 * 60 * 60 * 1000;      // 2 h
const DUE_SOON_WINDOW_MS        = 12 * 60 * 60 * 1000;     // 12 h
const DUE_CRITICAL_WINDOW_MS    = 2 * 60 * 60 * 1000;      // 2 h

// ── Helpers ───────────────────────────────────────────────────────────────

function customerMessageNewerThanTbReply(t: ThreadState): boolean {
  if (!t.last_customer_at) return false;
  if (!t.last_tb_reply_at) return true;
  return t.last_customer_at > t.last_tb_reply_at;
}

function isNudgedAndUnacked(t: ThreadState): boolean {
  return !!t.nudge_started_at && !t.nudge_ack_at;
}

function elapsedMs(ts: Date | null | undefined, now: Date): number | null {
  if (!ts) return null;
  return now.getTime() - ts.getTime();
}

function hasAlreadyAiAckdThisMessage(t: ThreadState): boolean {
  if (t.last_customer_comment_id && t.last_ai_ack_customer_comment_id) {
    return t.last_customer_comment_id === t.last_ai_ack_customer_comment_id;
  }
  if (t.last_ai_ack_at && t.last_customer_at) {
    return t.last_ai_ack_at >= t.last_customer_at;
  }
  return false;
}

function aiAckCooldownActive(t: ThreadState, now: Date): boolean {
  if (!t.last_ai_ack_at) return false;
  return (now.getTime() - t.last_ai_ack_at.getTime()) < AI_ACK_COOLDOWN_MS;
}

export function deadlineRiskLevel(t: ThreadState, now: Date): "NONE" | "LOW" | "HIGH" | "CRITICAL" {
  if (!t.due_at) return "NONE";
  const nowMs = now.getTime();
  if (nowMs >= t.due_at.getTime()) return "CRITICAL";
  const remaining = t.due_at.getTime() - nowMs;
  if (remaining <= DUE_CRITICAL_WINDOW_MS) return "HIGH";
  if (remaining <= DUE_SOON_WINDOW_MS) return "LOW";
  return "NONE";
}

function checkpointsExist(t: ThreadState): boolean {
  return !!(t.followup_half_at || t.followup_final_third_at);
}

function checkpointsBreached(t: ThreadState, now: Date): boolean {
  if (t.followup_half_at && now >= t.followup_half_at && !t.followup_half_done) return true;
  if (t.followup_final_third_at && now >= t.followup_final_third_at && !t.followup_final_third_done) return true;
  return false;
}

function conservativeOnTrackWhenCheckpointsMissing(t: ThreadState, now: Date): boolean {
  if (t.due_at && now >= t.due_at) return false;
  return true;
}

function taskSilenceToleranceMs(t: ThreadState): number {
  if (t.task_type === "reactive") return TOLERANCE_REACTIVE_MS;
  if (t.task_type === "deep_work") return TOLERANCE_DEEP_WORK_MS;
  return TOLERANCE_DEFAULT_MS;
}

function normalizeReliabilityScore(value: number | null | undefined): number | null {
  if (value == null) return null;
  const score = Number(value);
  if (isNaN(score) || score < 0) return null;
  if (score <= 1) return score;
  if (score <= 100) return score / 100;
  return null;
}

function reliabilityIsLow(t: ThreadState): boolean {
  const norm = normalizeReliabilityScore(t.va_reliability_score);
  if (norm != null && norm < 0.5) return true;
  if (t.va_missed_ack_rate != null && t.va_missed_ack_rate > 0.3) return true;
  return false;
}

function availabilityExpected(t: ThreadState): boolean | null {
  if (t.va_is_clocked_in === true) return true;
  if (t.va_in_scheduled_block === true) return true;
  if (t.va_is_clocked_in === false || t.va_in_scheduled_block === false) return false;
  return null;
}

function pushPlan(
  t: ThreadState,
  _now: Date,
  urgency: "low" | "medium" | "high" | "critical"
): string[] {
  const plan: string[] = [];
  if (t.assigned_va_slack_user_id) {
    plan.push("DM_ASSIGNEE");
  } else {
    plan.push("POST_TB_OPS_MISSING_SLACK_MAPPING");
  }
  if (urgency === "high" || urgency === "critical") plan.push("POST_TB_OPS_ESCALATE");
  if (urgency === "critical") plan.push("ENABLE_REASSIGN_BUTTON");
  return plan;
}

function canReassureCustomer(
  t: ThreadState,
  now: Date,
  _strictIfPossible: boolean
): boolean {
  if (!t.last_customer_at || !customerMessageNewerThanTbReply(t)) return false;
  if (hasAlreadyAiAckdThisMessage(t)) return false;
  if (aiAckCooldownActive(t, now)) {
    if (t.last_ai_ack_at && t.last_customer_at <= t.last_ai_ack_at) return false;
  }
  if (checkpointsExist(t)) {
    if (checkpointsBreached(t, now)) return false;
    return true;
  }
  return conservativeOnTrackWhenCheckpointsMissing(t, now);
}

// ── Main entry point ──────────────────────────────────────────────────────

export function decideActions(t: ThreadState, now: Date): Actions {
  const actions: Actions = { do_reassure: false, do_push: false, push_actions: [] };

  if (!customerMessageNewerThanTbReply(t)) return actions;

  const risk = deadlineRiskLevel(t, now);

  if (risk === "CRITICAL") {
    if (canReassureCustomer(t, now, true)) {
      actions.do_reassure = true;
      actions.reassure_reason = "deadline_missed_or_past_due";
    }
    actions.do_push = true;
    actions.push_actions.push(...pushPlan(t, now, "critical"));
    return actions;
  }

  if (isNudgedAndUnacked(t)) {
    const nudgeElapsedMs = elapsedMs(t.nudge_started_at, now) ?? 0;
    if (nudgeElapsedMs >= REASSURE_MIN_SILENCE_MS) {
      if (canReassureCustomer(t, now, true)) {
        actions.do_reassure = true;
        actions.reassure_reason = "nudged_no_ack_30m";
      }
    }
    if (reliabilityIsLow(t) && availabilityExpected(t) === true) {
      actions.do_push = true;
      actions.push_actions.push(...pushPlan(t, now, "medium"));
    }
    if (risk === "HIGH") {
      actions.do_push = true;
      actions.push_actions.push(...pushPlan(t, now, "high"));
    }
    return actions;
  }

  const silenceMs = elapsedMs(t.last_customer_at, now) ?? 0;
  if (silenceMs >= taskSilenceToleranceMs(t)) {
    if (canReassureCustomer(t, now, false)) {
      actions.do_reassure = true;
      actions.reassure_reason = "customer_silence_tolerance_exceeded";
    }
    if (risk === "HIGH" || reliabilityIsLow(t)) {
      actions.do_push = true;
      actions.push_actions.push(...pushPlan(t, now, "low"));
    }
  }

  return actions;
}

/** Build a QC acknowledgement message appropriate for the thread state. */
export function buildTaskbulletQcMessage(t: ThreadState, now: Date): string {
  if (t.due_at && now >= t.due_at) {
    return (
      "TaskBullet QC: Thanks for the note - we've seen this and are actively working on it. " +
      "We'll follow up as soon as possible."
    );
  }
  return (
    "TaskBullet QC: Thanks for the note - we've seen this and are reviewing it now. " +
    "We'll follow up shortly."
  );
}