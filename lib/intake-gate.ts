/**
 * lib/intake-gate.ts
 * Port of app/intake_gate.py
 *
 * Pure-logic task intake state machine. No I/O — all DB reads/writes are
 * the caller's responsibility.
 *
 * The gate determines whether a new/updated Basecamp todo has enough detail
 * to be posted to the job board, and manages a conversation flow to either:
 *   1. Confirm the todo is a placeholder (suppress indefinitely), or
 *   2. Request more details from the client before proceeding.
 *
 * States:
 *   ready                        — sufficient, proceed normally
 *   awaiting_placeholder_confirmation — waiting for client to say placeholder/assign
 *   awaiting_details             — waiting for client to provide more info
 *   placeholder_confirmed        — client confirmed placeholder, suppress permanently
 */

// ── Constants ────────────────────────────────────────────────────────────────

export const PLACEHOLDER_INTENT = "placeholder";
export const ASSIGN_INTENT      = "assign";

export const PROMPT_KIND_PLACEHOLDER = "placeholder_check";
export const PROMPT_KIND_DETAILS     = "details_request";
export const ACK_KIND_PLACEHOLDER    = "placeholder_ack";

export const STATE_AWAITING_PLACEHOLDER = "awaiting_placeholder_confirmation";
export const STATE_AWAITING_DETAILS     = "awaiting_details";
export const STATE_PLACEHOLDER_CONFIRMED = "placeholder_confirmed";
export const STATE_READY                = "ready";

export const SUPPRESS_STATES = new Set([
  STATE_AWAITING_PLACEHOLDER,
  STATE_AWAITING_DETAILS,
  STATE_PLACEHOLDER_CONFIRMED,
]);

const PLACEHOLDER_KEYWORDS = [
  "placeholder",
  "later",
  "not yet",
  "ignore",
  "for now",
  "hold",
  "tbd",
];

const ASSIGN_KEYWORDS = [
  "assign",
  "please do",
  "go ahead",
  "start",
  "yes",
  "ready",
];

// ── Text helpers ──────────────────────────────────────────────────────────────

const TAG_RE  = /<[^>]+>/g;
const ENTITY_RE = /&[a-zA-Z0-9#]+;/g;
const WS_RE   = /\s+/g;

export function normalizeText(text: string | null | undefined): string {
  if (!text) return "";
  let cleaned = String(text).replace(TAG_RE, "").replace(ENTITY_RE, " ");
  cleaned = cleaned.replace(WS_RE, " ");
  return cleaned.trim();
}

export function normalizeState(state: string | null | undefined): string {
  if (!state) return STATE_READY;
  const norm = String(state).trim().toLowerCase();
  return norm || STATE_READY;
}

// ── Keyword matcher ───────────────────────────────────────────────────────────

function keywordInText(text: string, keyword: string): boolean {
  if (keyword.includes(" ")) return text.includes(keyword);
  return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
}

// ── Public: classify reply intent ─────────────────────────────────────────────

export function classifyReplyIntent(
  text: string | null | undefined
): typeof PLACEHOLDER_INTENT | typeof ASSIGN_INTENT | null {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) return null;
  if (PLACEHOLDER_KEYWORDS.some((kw) => keywordInText(normalized, kw))) return PLACEHOLDER_INTENT;
  if (ASSIGN_KEYWORDS.some((kw) => keywordInText(normalized, kw))) return ASSIGN_INTENT;
  return null;
}

// ── Public: detail insufficiency check ───────────────────────────────────────

export interface DetailCheckArgs {
  description?: string | null;
  extraText?: string | null;
  minChars?: number;
  dueOn?: Date | string | null;
  dueRequired?: boolean;
}

export function detailIsInsufficient(args: DetailCheckArgs): boolean {
  const { description, extraText, minChars = 20, dueOn, dueRequired = false } = args;
  const parts = [normalizeText(description), normalizeText(extraText)];
  const combined = parts.filter(Boolean).join(" ").trim();
  if (!combined) return true;
  if (combined.length < minChars) return true;
  if (dueRequired && !dueOn) return true;
  return false;
}

// ── Public: reprompt eligibility ─────────────────────────────────────────────

export interface ShouldRepromptArgs {
  now: Date;
  lastPingAt: Date | null | undefined;
  pingCount: number | null | undefined;
  cooldownMs: number;
  maxPings: number;
}

export function shouldReprompt(args: ShouldRepromptArgs): boolean {
  const { now, lastPingAt, pingCount, cooldownMs, maxPings } = args;
  const count = typeof pingCount === "number" ? pingCount : 0;
  if (count >= maxPings) return false;
  if (lastPingAt && now.getTime() - new Date(lastPingAt).getTime() < cooldownMs) return false;
  return true;
}

// ── Public: GateAction + GateDecision ────────────────────────────────────────

export interface GateDecision {
  suppress_slack: boolean;
  next_state: string;
  prompt_kind: string | null;
  reset_ping_state: boolean;
  increment_ping: boolean;
}

export interface PlanGateActionArgs {
  state?: string | null;
  insufficient: boolean;
  lastPingAt?: Date | null;
  pingCount?: number | null;
  now: Date;
  cooldownMs: number;
  maxDetailPings: number;
  maxPlaceholderPings?: number;
}

/**
 * Decide what the gate should do when a todo is created or updated.
 * Pure function — no side effects.
 */
export function planGateAction(args: PlanGateActionArgs): GateDecision {
  const {
    state,
    insufficient,
    lastPingAt,
    pingCount,
    now,
    cooldownMs,
    maxDetailPings,
    maxPlaceholderPings = 1,
  } = args;

  const stateNorm = normalizeState(state);
  const decision: GateDecision = {
    suppress_slack:   false,
    next_state:       stateNorm,
    prompt_kind:      null,
    reset_ping_state: false,
    increment_ping:   false,
  };

  if (stateNorm === STATE_PLACEHOLDER_CONFIRMED) {
    decision.suppress_slack = true;
    return decision;
  }

  if (!insufficient) {
    if (SUPPRESS_STATES.has(stateNorm)) {
      decision.next_state       = STATE_READY;
      decision.reset_ping_state = true;
    }
    return decision;
  }

  decision.suppress_slack = true;

  const repromptPlaceholder = shouldReprompt({
    now, lastPingAt, pingCount, cooldownMs, maxPings: maxPlaceholderPings,
  });

  if (stateNorm === STATE_READY) {
    decision.next_state       = STATE_AWAITING_PLACEHOLDER;
    decision.reset_ping_state = true;
    if (repromptPlaceholder) {
      decision.prompt_kind    = PROMPT_KIND_PLACEHOLDER;
      decision.increment_ping = true;
    }
    return decision;
  }

  if (stateNorm === STATE_AWAITING_PLACEHOLDER) {
    if (repromptPlaceholder) {
      decision.prompt_kind    = PROMPT_KIND_PLACEHOLDER;
      decision.increment_ping = true;
    }
    return decision;
  }

  // STATE_AWAITING_DETAILS or STATE_PLACEHOLDER_CONFIRMED already handled above
  if (stateNorm === STATE_AWAITING_DETAILS || stateNorm === STATE_PLACEHOLDER_CONFIRMED) {
    return decision;
  }

  // Unknown state — reset to awaiting_placeholder
  decision.next_state       = STATE_AWAITING_PLACEHOLDER;
  decision.reset_ping_state = true;
  if (repromptPlaceholder) {
    decision.prompt_kind    = PROMPT_KIND_PLACEHOLDER;
    decision.increment_ping = true;
  }
  return decision;
}

// ── Reply action decision ──────────────────────────────────────────────────────

export interface ReplyDecision {
  next_state: string;
  prompt_kind: string | null;
  ack_kind: string | null;
  reset_ping_state: boolean;
  increment_ping: boolean;
}

export interface PlanReplyActionArgs {
  state?: string | null;
  replyText?: string | null;
  insufficient: boolean;
  lastPingAt?: Date | null;
  pingCount?: number | null;
  now: Date;
  cooldownMs: number;
  maxDetailPings: number;
}

/**
 * Decide what to do when a client replies to an intake-gated thread.
 * Pure function — no side effects.
 */
export function planReplyAction(args: PlanReplyActionArgs): ReplyDecision {
  const {
    state, replyText, insufficient, lastPingAt, pingCount, now, cooldownMs, maxDetailPings,
  } = args;

  const stateNorm = normalizeState(state);
  const decision: ReplyDecision = {
    next_state:       stateNorm,
    prompt_kind:      null,
    ack_kind:         null,
    reset_ping_state: false,
    increment_ping:   false,
  };

  const intent = classifyReplyIntent(replyText);

  if (stateNorm === STATE_AWAITING_PLACEHOLDER) {
    if (intent === PLACEHOLDER_INTENT) {
      decision.next_state       = STATE_PLACEHOLDER_CONFIRMED;
      decision.ack_kind         = ACK_KIND_PLACEHOLDER;
      decision.reset_ping_state = true;
      return decision;
    }
    if (intent === ASSIGN_INTENT) {
      decision.next_state       = STATE_AWAITING_DETAILS;
      decision.prompt_kind      = PROMPT_KIND_DETAILS;
      decision.reset_ping_state = true;
      decision.increment_ping   = true;
      return decision;
    }
    if (!insufficient) {
      decision.next_state       = STATE_READY;
      decision.reset_ping_state = true;
    }
    return decision;
  }

  if (stateNorm === STATE_PLACEHOLDER_CONFIRMED) {
    if (intent === ASSIGN_INTENT) {
      decision.next_state       = STATE_AWAITING_DETAILS;
      decision.prompt_kind      = PROMPT_KIND_DETAILS;
      decision.reset_ping_state = true;
      decision.increment_ping   = true;
      return decision;
    }
    if (!insufficient) {
      decision.next_state       = STATE_READY;
      decision.reset_ping_state = true;
    }
    return decision;
  }

  if (stateNorm === STATE_AWAITING_DETAILS) {
    if (!insufficient) {
      decision.next_state       = STATE_READY;
      decision.reset_ping_state = true;
      return decision;
    }
    if (shouldReprompt({ now, lastPingAt, pingCount, cooldownMs, maxPings: maxDetailPings })) {
      decision.prompt_kind    = PROMPT_KIND_DETAILS;
      decision.increment_ping = true;
    }
    return decision;
  }

  return decision;
}
