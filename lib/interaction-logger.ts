/**
 * lib/interaction-logger.ts
 * ~~~~~~~~~~~~~~~~~~~~~~~~~
 * Port of app/interaction_logger.py.
 *
 * - classifyMessageType()    → heuristic regex classifier
 * - logInteraction()         → insert into `interactions`
 * - upsertTaskOwnership()    → insert/update `task_ownership`
 * - resolveCustomerIdFromBucket()
 * - resolveVaIdFromBasecampPerson()
 */

import { prisma } from "@/lib/prisma";

// ── Message classifier ────────────────────────────────────────────────────

const ACK_RE = /^\s*(ok|okay|got it|noted|thanks|thank you|understood|will do|done|sure|sounds good|great|perfect|roger)[.!]?\s*$/i;
const BLOCKER_RE = /\b(blocked|blocker|stuck|unable|can'?t|cannot|error|fail(ed|ing)?|broken|issue|problem|help me|help needed)\b/i;
const QUESTION_RE = /\b(what|when|where|why|how|who|which|can you|could you|would you)\b|\?/i;
const UPDATE_RE = /\b(update|progress|completed|done|finished|status|delivered|sent|uploaded|submitted|resolved|fixed)\b/i;

export type MessageType = "question" | "blocker" | "ack" | "update" | "other";

export function classifyMessageType(text: string): MessageType {
  const t = (text || "").trim();
  if (!t) return "other";
  if (ACK_RE.test(t)) return "ack";
  if (BLOCKER_RE.test(t)) return "blocker";
  if (QUESTION_RE.test(t)) return "question";
  if (UPDATE_RE.test(t)) return "update";
  return "other";
}

// ── Lookup helpers ─────────────────────────────────────────────────────────

export async function resolveCustomerIdFromBucket(
  bucketId: string
): Promise<number | null> {
  try {
    const row = await prisma.customer.findFirst({
      where: { basecamp_project_id: String(bucketId) },
      select: { id: true },
    });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export async function resolveVaIdFromBasecampPerson(
  basecampPersonId: string
): Promise<number | null> {
  try {
    const row = await prisma.va.findFirst({
      where: { basecamp_person_id: String(basecampPersonId) },
      select: { id: true },
    });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

// ── Core write helpers ─────────────────────────────────────────────────────

export interface LogInteractionInput {
  source: string;
  interaction_type: string;
  happened_at: Date;
  customer_id: number;
  todo_id?: string | null;
  person_id?: number | null;
  payload?: Record<string, unknown> | null;
}

/**
 * Insert a row into `interactions`.
 * Silently catches errors and returns false on failure.
 */
export async function logInteraction(input: LogInteractionInput): Promise<boolean> {
  try {
    await prisma.interaction.create({
      data: {
        source: input.source,
        interaction_type: input.interaction_type,
        happened_at: input.happened_at,
        customer_id: input.customer_id,
        todo_id: input.todo_id ?? null,
        person_id: input.person_id ?? null,
        payload: (input.payload ?? {}) as object,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export interface UpsertTaskOwnershipInput {
  todo_id: string;
  bucket_id: string;
  customer_id: number;
  responsible_va_id: number;
  contributor_va_ids?: number[];
}

/**
 * Insert or update task_ownership for (todo_id, bucket_id).
 * Silently skips on error. Returns true on success.
 */
export async function upsertTaskOwnership(input: UpsertTaskOwnershipInput): Promise<boolean> {
  try {
    const now = new Date();
    await prisma.taskOwnership.upsert({
      where: {
        task_ownership_todo_bucket_unique: {
          todo_id: String(input.todo_id),
          bucket_id: String(input.bucket_id),
        },
      },
      update: {
        customer_id: input.customer_id,
        responsible_va_id: input.responsible_va_id,
        contributor_va_ids: (input.contributor_va_ids ?? []) as object,
        active: true,
        updated_at: now,
      },
      create: {
        todo_id: String(input.todo_id),
        bucket_id: String(input.bucket_id),
        customer_id: input.customer_id,
        responsible_va_id: input.responsible_va_id,
        contributor_va_ids: (input.contributor_va_ids ?? []) as object,
        active: true,
        assigned_at: now,
        created_at: now,
        updated_at: now,
      },
    });
    return true;
  } catch {
    return false;
  }
}