/**
 * AI Brain engine — TypeScript port of ai_brain/main.py
 *
 * All logic is deterministic (heuristic Phase-1). No external calls.
 * API routes are thin wrappers that call these functions.
 */
import { POLICY } from "./policy";
import { randomUUID } from "crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FollowupPayload {
  todo?: Record<string, unknown> | null;
  thread?: Record<string, unknown> | null;
  customer_text?: string | null;
}

export interface MilestonePlanRequest {
  customer_text: string;
  context?: Record<string, unknown> | null;
}

export interface CommsDraftRequest {
  customer_text: string;
  milestone_plan?: Record<string, unknown> | null;
  thread?: Record<string, unknown> | null;
}

export interface RouteAssignRequest {
  customer_text: string;
  context?: Record<string, unknown> | null;
  milestone_plan?: Record<string, unknown> | null;
  va_signal?: Record<string, unknown> | null;
}

interface Milestone {
  name: string;
  definition_of_done: string;
  owner: string;
  tasks: string[];
  due_hint: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeText(x: string | null | undefined): string {
  return (x ?? "").trim();
}

function decisionEnvelope(startMs: number) {
  return {
    decision_id: randomUUID(),
    decision_time_ms: Date.now() - startMs,
    policy_loaded: true,
    policy_hash: "embedded",
  };
}

function detectBlocker(text: string): boolean {
  const t = text.toLowerCase();
  const terms = ["blocked","can't","cannot","unable","no access","need access","need login",
    "credentials","waiting on","stuck","permission","permissions"];
  return terms.some(term => t.includes(term));
}

function detectPriority(text: string): string {
  const t = text.toLowerCase();
  if (POLICY.sla_and_followup.urgency_keywords.some(k => t.includes(k.toLowerCase()))) {
    return "high";
  }
  return POLICY.sla_and_followup.default_priority;
}

function rankSkillBuckets(text: string, topK = 2): string[] {
  const tl = text.toLowerCase();
  const scores: Array<[number, string]> = [];
  for (const [bucket, cfg] of Object.entries(POLICY.routing.skill_buckets)) {
    const score = cfg.keywords.filter(kw => kw && tl.includes(kw)).length;
    if (score > 0) scores.push([score, bucket]);
  }
  scores.sort((a, b) => b[0] - a[0]);
  const ranked = scores.slice(0, topK).map(([, b]) => b);
  return ranked.length > 0 ? ranked : [POLICY.routing.fallback_bucket];
}

function roleForBucket(bucket: string): string {
  return POLICY.routing.roles[bucket] ?? "VA";
}

function shouldEscalateOps(
  priority: string,
  text: string,
  vaSignal?: Record<string, unknown> | null
): [boolean, string] {
  let blocked = detectBlocker(text);
  if (vaSignal) {
    if (vaSignal.blocked === true) blocked = true;
    if (Array.isArray(vaSignal.blockers) && vaSignal.blockers.length > 0) blocked = true;
    if (vaSignal.missing_access === true) blocked = true;
  }
  if (POLICY.automation.escalation_rules.urgent_and_blocked && priority === "high" && blocked) {
    return [true, "Urgent + blocked (access/tools/info needed)."];
  }
  return [false, ""];
}

function buildClarifyingQuestions(text: string, buckets: string[]): string[] {
  const maxQ = POLICY.templates.client_clarifying_questions.max_questions;
  const t = text.trim();
  const hasDue = ["by ","due","deadline","tomorrow","today","this week","next week","date"]
    .some(k => t.toLowerCase().includes(k));

  const qs: string[] = [];
  qs.push("What does 'done' look like for you (final format/output + where it should live)?");
  if (!hasDue) qs.push("Is there a deadline or ideal timeline for this?");

  const primary = buckets[0] ?? "admin";
  const bucketQ: Record<string, string> = {
    web:            "Do we have access (WordPress login/hosting) and the exact page(s) this affects?",
    bookkeeping:    "Which system are we using (QuickBooks, Xero, etc.) and what date range should we work on?",
    design:         "Do you have brand assets (logo, colors, examples) we should match?",
    video_editing:  "Where are the raw files and what's the target platform/length (Reel/TikTok/YouTube)?",
    sales:          "Who is the target audience and what's the desired next step (call booked, quote sent, etc.)?",
    social_posts:   "Any promos, offers, or links that must be included in the post(s)?",
  };
  qs.push(bucketQ[primary] ?? "Any constraints we should know (tools, logins, budget, preferences)?");

  const deduped = [...new Set(qs.filter(Boolean))];
  return deduped.slice(0, maxQ);
}

function defaultTasksForBucket(bucket: string): string[] {
  const base = [
    "Summarize the request into a one-paragraph scope statement.",
    "List blockers/access needed (logins, files, links).",
  ];
  const bucketTasks: Record<string, string[]> = {
    admin:         ["Turn the request into a checklist and propose a timeline.", "Confirm preferred communication cadence (daily/weekly)."],
    bookkeeping:   ["Confirm system + date range.", "Identify missing docs (bank feeds/receipts)."],
    social_posts:  ["Draft 3 post options and a posting schedule.", "Confirm promo details + links + hashtags."],
    video_editing: ["Confirm target platform specs (length, aspect ratio).", "Draft an edit outline (hook, beats, CTA)."],
    sales:         ["Define target persona and offer.", "Draft outreach script + follow-up sequence."],
    web:           ["Confirm page(s)/URL(s) and access.", "Draft proposed changes and rollout plan."],
    design:        ["Collect brand assets + examples.", "Draft 2 concept directions + revision plan."],
  };
  return [...base, ...(bucketTasks[bucket] ?? [])];
}

function firstMilestone(plan: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!plan || typeof plan !== "object") return null;
  const ms = plan.milestones;
  if (Array.isArray(ms) && ms.length > 0 && typeof ms[0] === "object") {
    return ms[0] as Record<string, unknown>;
  }
  return null;
}

function deriveNextStep(plan: Record<string, unknown> | null | undefined, fallbackBucket: string): string {
  const first = firstMilestone(plan);
  if (first) {
    const tasks = first.tasks;
    if (Array.isArray(tasks) && tasks.length > 0) {
      return tasks.slice(0, 3).map(String).join("; ");
    }
    if (typeof first.name === "string") return `Start with: ${first.name}`;
  }
  return `Start by summarizing the scope and confirming details (${fallbackBucket}).`;
}

function deriveTimeline(plan: Record<string, unknown> | null | undefined): string {
  const first = firstMilestone(plan);
  if (first && typeof first.due_hint === "string") {
    return `We target: ${first.due_hint} (will confirm once details are set).`;
  }
  return "Will propose a timeline after you confirm the details.";
}

function summarizeText(text: string, limit = 280): string {
  const t = text.trim();
  return t.length <= limit ? t : `${t.slice(0, limit - 3).trimEnd()}...`;
}

function questionsBlock(questions: string[]): string {
  if (questions.length === 0) return "- None for now; we can start immediately.";
  return questions.map(q => `- ${q}`).join("\n");
}

function toneNotes(): string[] {
  return [
    "Be honest, confident, and friendly.",
    "Keep it short: short paragraphs, bullets for lists.",
    "Always end with an explicit next step and timeline.",
    "Communicate early, even if the update isn't ideal.",
  ];
}

function formatClientDraft(
  text: string,
  clarifying: string[],
  plan: Record<string, unknown> | null | undefined,
  buckets: string[]
): string {
  const summary = summarizeText(text);
  const nextStep = deriveNextStep(plan, buckets[0] ?? POLICY.routing.fallback_bucket);
  const timeline = deriveTimeline(plan);
  const qBlock = questionsBlock(clarifying);

  return [
    "Quick update:",
    summary ? `We received: "${summary}"` : "",
    "",
    clarifying.length > 0 ? "To nail this down, I just need:" : "",
    qBlock,
    "",
    "Next step:",
    nextStep,
    "",
    "Timeline:",
    timeline,
  ].filter(l => l !== undefined).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function formatVaNudge(
  text: string,
  plan: Record<string, unknown> | null | undefined
): string {
  const first = firstMilestone(plan);
  const taskSummary = first && Array.isArray(first.tasks) && first.tasks.length > 0
    ? String(first.tasks[0])
    : summarizeText(text, 120);
  const due = (first && typeof first.due_hint === "string") ? first.due_hint : "TBD";

  return [
    "Hey — quick check:",
    `- Task: ${taskSummary}`,
    `- Due: ${due}`,
    `- Scope: ${summarizeText(text, 160)}`,
    "Any blockers or access needed? If so, list them and I'll handle it.",
  ].join("\n");
}

function maybeOpsEscalation(text: string, priority: string): string | null {
  const [shouldEsc, reason] = shouldEscalateOps(priority, text);
  if (!shouldEsc) return null;
  return [
    "⚠️ Ops escalation draft:",
    reason,
    `Original request: "${summarizeText(text, 200)}"`,
    "Recommended action: reassign or unblock ASAP.",
  ].join("\n");
}

// ── Exported endpoint logic ───────────────────────────────────────────────────

export function runFollowupClassify(payload: FollowupPayload): Record<string, unknown> {
  const startMs = Date.now();
  const text = safeText(payload.customer_text).toLowerCase();

  const questiony = ["?","can you","could you","please","when","how","update","status"]
    .some(k => text.includes(k));
  const urgent = ["asap","urgent","today","now","immediately","deadline","overdue"]
    .some(k => text.includes(k));

  const needsFollowup = Boolean(text) && (questiony || urgent);
  const whoToNudge = needsFollowup ? "tb" : "none";
  const priority = urgent ? "high" : needsFollowup ? POLICY.sla_and_followup.default_priority : "low";

  return {
    needs_followup: needsFollowup,
    who_to_nudge: whoToNudge,
    reason: needsFollowup
      ? "heuristic_v1: question/urgency keyword match"
      : "heuristic_v1: no follow-up needed",
    is_resolved: false,
    priority,
    org_mode: "taskbullet",
    ...decisionEnvelope(startMs),
  };
}

export function runPlanMilestones(payload: MilestonePlanRequest): Record<string, unknown> {
  const startMs = Date.now();
  const text = (payload.customer_text ?? "").trim();
  const buckets = rankSkillBuckets(text, 2);
  const priority = detectPriority(text);
  const clarifying = buildClarifyingQuestions(text, buckets);
  const framework = POLICY.milestones.framework;
  const primaryBucket = buckets[0] ?? "admin";
  const [shouldEscalate, escalationReason] = shouldEscalateOps(priority, text);

  const milestones: Milestone[] = [
    {
      name: framework[0].name,
      definition_of_done: framework[0].definition_of_done,
      owner: "ai",
      tasks: [
        "Draft 1-3 clarifying questions.",
        "Draft a confident next step message while waiting for answers.",
      ],
      due_hint: "same day",
    },
    {
      name: framework[1].name,
      definition_of_done: framework[1].definition_of_done,
      owner: "ai",
      tasks: [
        "Convert the clarified scope into milestones + checklist tasks.",
        "Assign owners (VA/AI/client) and propose a timeline.",
      ],
      due_hint: "same day",
    },
    {
      name: framework[2].name,
      definition_of_done: framework[2].definition_of_done,
      owner: "va",
      tasks: [
        ...defaultTasksForBucket(primaryBucket),
        "Set a progress update cadence and send the first update.",
        "If blocked, escalate immediately with options + timeline impact.",
      ],
      due_hint: "based on deadline",
    },
    {
      name: framework[3].name,
      definition_of_done: framework[3].definition_of_done,
      owner: "va",
      tasks: [
        "Deliver final output (link/file) + short summary.",
        "Offer the next logical step.",
      ],
      due_hint: "on completion",
    },
  ];

  return {
    clarifying_questions: clarifying,
    recommended_skill_buckets: buckets,
    priority,
    milestones,
    notes: [
      "TaskBullet standard: honest, confident, communicate early.",
      "If tools/skills are missing, escalate quickly: reassign or reset expectations.",
    ],
    should_escalate_ops: shouldEscalate,
    escalation_reason: escalationReason,
    ...decisionEnvelope(startMs),
  };
}

export function runCommsDraft(payload: CommsDraftRequest): Record<string, unknown> {
  const startMs = Date.now();
  const text = (payload.customer_text ?? "").trim();
  const buckets = rankSkillBuckets(text, 2);
  const clarifying = buildClarifyingQuestions(text, buckets);
  const priority = detectPriority(text);
  const [shouldEscalate, escalationReason] = shouldEscalateOps(priority, text);

  const clientDraft = formatClientDraft(text, clarifying, payload.milestone_plan, buckets);
  const vaNudgeDraft = formatVaNudge(text, payload.milestone_plan);
  const opsEscalationDraft = maybeOpsEscalation(text, priority);

  return {
    client_draft: clientDraft,
    va_nudge_draft: vaNudgeDraft,
    ops_escalation_draft: opsEscalationDraft,
    tone_notes: toneNotes(),
    recommended_skill_buckets: buckets,
    priority,
    should_escalate_ops: shouldEscalate,
    escalation_reason: escalationReason,
    ...decisionEnvelope(startMs),
  };
}

export function runRouteAssign(payload: RouteAssignRequest): Record<string, unknown> {
  const startMs = Date.now();
  const text = (payload.customer_text ?? "").trim();
  const buckets = rankSkillBuckets(text, 2);
  const priority = detectPriority(text);

  const fallbackBucket = POLICY.routing.fallback_bucket;
  const usedFallback = buckets[0] === fallbackBucket;
  const confidence = usedFallback ? 0.6 : 0.9;

  const primaryBucket = buckets[0] ?? fallbackBucket;
  const role = roleForBucket(primaryBucket);

  const [shouldEscalate, escalationReason] = shouldEscalateOps(priority, text, payload.va_signal);

  let needsReassign = shouldEscalate;
  const reasonBits: string[] = shouldEscalate ? [escalationReason] : [];

  if (payload.va_signal && typeof payload.va_signal === "object") {
    const vs = payload.va_signal;
    if (vs.scope_mismatch === true) { needsReassign = true; reasonBits.push("Scope mismatch reported by VA."); }
    if (vs.wrong_skill_bucket === true) { needsReassign = true; reasonBits.push("Current assignee not aligned with required skill bucket."); }
    if (vs.missing_access === true) reasonBits.push("Missing access/tools reported by VA.");
    if (vs.at_risk_due_date === true) reasonBits.push("Due date risk reported by VA.");
  }

  const reason = reasonBits.join(" ").trim() || "Routed by policy keyword match.";
  const internalNudge = [
    `Routing suggestion: *${primaryBucket}* (${role}).`,
    `Priority: *${priority}*.`,
    needsReassign
      ? "Recommend Ops review / reassignment."
      : "Proceed with current assignment.",
  ].join(" ");

  return {
    recommended_skill_buckets: buckets,
    recommended_role: role,
    confidence,
    priority,
    needs_reassign: needsReassign,
    reason,
    should_escalate_ops: shouldEscalate,
    escalation_reason: escalationReason,
    internal_nudge_draft: internalNudge,
    ...decisionEnvelope(startMs),
  };
}