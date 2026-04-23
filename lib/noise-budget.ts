/**
 * lib/noise-budget.ts
 * Port of app/noise_budget.py
 *
 * Per-channel daily post-budget tracking. Prevents alert fatigue by capping
 * Slack posts per channel per day. When exhausted, posts should be suppressed
 * or batched into a single digest.
 *
 * NOTE: In a serverless environment each function instance has its own
 * in-memory state, matching the Python per-worker behaviour. Budget counts
 * do not persist across cold starts or across multiple parallel instances.
 * This is intentional — the same trade-off exists in the Python app.
 *
 * Usage:
 *   import { checkBudget, recordPost } from "@/lib/noise-budget";
 *
 *   if (!checkBudget("ops_channel")) return; // budget exhausted
 *   await postToOps(...);
 *   recordPost("ops_channel");
 */

// ── In-memory counters ────────────────────────────────────────────────────────

interface ChannelEntry {
  date: string;  // "YYYY-MM-DD"
  count: number;
}

const _counters = new Map<string, ChannelEntry>();

// ── Config ────────────────────────────────────────────────────────────────────

/** Default caps. Can be overridden per channel via NOISE_BUDGET_CAPS env var (JSON). */
const DEFAULT_CAPS: Record<string, number> = {
  ops_channel:           30,
  va_nudge:              50,
  manager_escalation:    20,
  upper_tier_escalation: 10,
};

function getCap(channelKey: string): number {
  try {
    const envCaps = process.env.NOISE_BUDGET_CAPS;
    if (envCaps) {
      const parsed = JSON.parse(envCaps) as Record<string, number>;
      if (typeof parsed[channelKey] === "number") return parsed[channelKey];
    }
  } catch {
    // ignore malformed JSON
  }
  return DEFAULT_CAPS[channelKey] ?? 999;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function getOrReset(channelKey: string): ChannelEntry {
  const today = todayIso();
  const entry = _counters.get(channelKey);
  if (!entry || entry.date !== today) {
    const fresh: ChannelEntry = { date: today, count: 0 };
    _counters.set(channelKey, fresh);
    return fresh;
  }
  return entry;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return true if the channel still has budget remaining today.
 * Does NOT increment the counter — call recordPost() after a successful send.
 */
export function checkBudget(channelKey: string): boolean {
  const entry = getOrReset(channelKey);
  return entry.count < getCap(channelKey);
}

/**
 * Increment the post counter for a channel. Returns the new count.
 */
export function recordPost(channelKey: string): number {
  const entry = getOrReset(channelKey);
  entry.count++;
  return entry.count;
}

/**
 * Return how many posts remain in the budget for this channel today.
 */
export function getRemaining(channelKey: string): number {
  const entry = getOrReset(channelKey);
  return Math.max(0, getCap(channelKey) - entry.count);
}

/**
 * Return a snapshot of all active channel counters for today.
 * Useful for dashboards and debugging.
 */
export function getAllCounts(): Record<
  string,
  { count: number; cap: number; remaining: number; exhausted: boolean }
> {
  const today = todayIso();
  const result: Record<string, { count: number; cap: number; remaining: number; exhausted: boolean }> = {};
  for (const [key, entry] of _counters) {
    if (entry.date === today) {
      const cap       = getCap(key);
      const remaining = Math.max(0, cap - entry.count);
      result[key] = {
        count:     entry.count,
        cap,
        remaining,
        exhausted: entry.count >= cap,
      };
    }
  }
  return result;
}

/**
 * Force-reset all counters (for testing or manual day-boundary recovery).
 */
export function resetCounters(): void {
  _counters.clear();
}
