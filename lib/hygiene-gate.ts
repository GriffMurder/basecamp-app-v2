/**
 * lib/hygiene-gate.ts
 * Port of app/hygiene_gate.py
 *
 * Pure-logic task hygiene state machine. No I/O.
 *
 * Detects "implicit assignment" — a task that appears unassigned in Basecamp
 * but where an internal team member has already posted a deliverable-like
 * comment (attachment, link, or keyword-rich text). When detected, the gate:
 *   - Suppresses the public job-board post (task is already being worked)
 *   - Optionally sends a hygiene DM to the VA to formally claim the task
 *
 * Status values (stored on BasecampThreadActivity.hygiene_dm_status):
 *   pending    — default, eligible for DM
 *   completed  — task formally claimed / resolved
 *   escalated  — no slack user mapping found, escalated to Ops
 *   suppressed — manually suppressed
 */

// ── Status constants ─────────────────────────────────────────────────────────

export const HYGIENE_STATUS_PENDING    = "pending";
export const HYGIENE_STATUS_COMPLETED  = "completed";
export const HYGIENE_STATUS_ESCALATED  = "escalated";
export const HYGIENE_STATUS_SUPPRESSED = "suppressed";

const TERMINAL_STATUSES = new Set([
  HYGIENE_STATUS_COMPLETED,
  HYGIENE_STATUS_ESCALATED,
  HYGIENE_STATUS_SUPPRESSED,
]);

// ── Deliverable detection ────────────────────────────────────────────────────

export const DELIVERABLE_PHRASES = [
  "attached",
  "here's",
  "draft",
  "completed",
  "finished",
  "deliverable",
  "link:",
  "google doc",
  "loom",
];

const URL_RE = /(https?:\/\/\S+|www\.[^\s]+)/i;

export function textHasLink(text: string | null | undefined): boolean {
  if (!text) return false;
  return URL_RE.test(text);
}

export interface LooksLikeDeliverableArgs {
  text?: string | null;
  hasAttachments?: boolean;
  hasLinks?: boolean;
  minLength?: number;
  phrases?: string[];
}

export function looksLikeDeliverable(args: LooksLikeDeliverableArgs): boolean {
  const {
    text,
    hasAttachments = false,
    hasLinks = false,
    minLength = 200,
    phrases = DELIVERABLE_PHRASES,
  } = args;

  if (hasAttachments || hasLinks) return true;

  const normalized = (text ?? "").trim();
  if (normalized.length >= minLength) return true;

  const lowered = normalized.toLowerCase();
  return phrases.some((phrase) => lowered.includes(phrase));
}

// ── Implicit-assignment detection ────────────────────────────────────────────

export interface IsImplicitlyWorkedArgs {
  isUnassigned: boolean;
  lastCommentInternal: boolean;
  lastInternalAt: Date | null | undefined;
  lastCustomerAt: Date | null | undefined;
  deliverable: boolean;
}

export function isImplicitlyWorked(args: IsImplicitlyWorkedArgs): boolean {
  const { isUnassigned, lastCommentInternal, lastInternalAt, lastCustomerAt, deliverable } = args;
  if (!isUnassigned) return false;
  if (!lastCommentInternal) return false;
  if (!lastInternalAt) return false;
  if (lastCustomerAt) {
    const internalTs = new Date(lastInternalAt).getTime();
    const customerTs = new Date(lastCustomerAt).getTime();
    if (internalTs <= customerTs) return false;
  }
  if (!deliverable) return false;
  return true;
}

// ── DM eligibility ───────────────────────────────────────────────────────────

export interface ShouldSendDmArgs {
  status: string | null | undefined;
  lastSentAt: Date | null | undefined;
  now: Date;
  cooldownMs: number;
}

export function normalizeHygieneStatus(status: string | null | undefined): string {
  if (!status) return HYGIENE_STATUS_PENDING;
  const norm = String(status).trim().toLowerCase();
  return norm || HYGIENE_STATUS_PENDING;
}

export function shouldSendDm(args: ShouldSendDmArgs): boolean {
  const { status, lastSentAt, now, cooldownMs } = args;
  if (TERMINAL_STATUSES.has(normalizeHygieneStatus(status))) return false;
  if (lastSentAt && now.getTime() - new Date(lastSentAt).getTime() < cooldownMs) return false;
  return true;
}

// ── Main gate decision ────────────────────────────────────────────────────────

export interface HygieneGateArgs {
  isUnassigned: boolean;
  lastCommentInternal: boolean;
  lastInternalAt: Date | null | undefined;
  lastCustomerAt: Date | null | undefined;
  deliverable: boolean;
  status: string | null | undefined;
  lastSentAt: Date | null | undefined;
  now: Date;
  cooldownMs: number;
}

export interface HygieneGateDecision {
  implicit: boolean;
  suppress_slack: boolean;
  send_dm: boolean;
  status: string;
}

/**
 * Decide what the hygiene gate should do for a given thread.
 * Pure function — no side effects.
 */
export function planHygieneAction(args: HygieneGateArgs): HygieneGateDecision {
  const {
    isUnassigned, lastCommentInternal, lastInternalAt, lastCustomerAt,
    deliverable, status, lastSentAt, now, cooldownMs,
  } = args;

  const implicit = isImplicitlyWorked({
    isUnassigned,
    lastCommentInternal,
    lastInternalAt,
    lastCustomerAt,
    deliverable,
  });

  const suppress = implicit;
  let sendDm = false;

  if (implicit) {
    sendDm = shouldSendDm({ status, lastSentAt, now, cooldownMs });
  }

  return {
    implicit,
    suppress_slack: suppress,
    send_dm: sendDm,
    status: normalizeHygieneStatus(status),
  };
}
