/**
 * GET /api/assign-recommend?title=...&limit=5
 *
 * Recommends VAs for a todo using scoring weights from assign_recommend.py:
 *   adjusted_reliability  * 0.40
 *   capacity (inverted)   * 0.30
 *   task-type match       * 0.20  (keyword cluster, last-30 task_ownership history)
 *   skill_match neutral   * 0.10  (50/100 — no TaskClaim model)
 *
 * Risk levels:
 *   ok         — proceed
 *   warning    — reliability < 75 OR capacity_index > 70
 *   hard_block — reliability < 65 AND capacity_index > 80
 *
 * Throttle adjustments (VaLoadState):
 *   soft_throttle  — composite * 0.80, warn flag
 *   hard_throttle  — composite * 0.80 + escalate to at least warning
 *   burnout_flag   — escalate to at least warning
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { vaUuid } from "@/lib/uuid5";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Task-type keyword clusters (mirrors assign_recommend.py) ────────────────
const TYPE_CLUSTERS: [string, string[]][] = [
  ["writing",   ["write", "writing", "content", "copy", "blog", "article", "draft", "proofread", "edit"]],
  ["data",      ["data", "spreadsheet", "excel", "csv", "analysis", "analytics", "report", "database"]],
  ["admin",     ["admin", "schedule", "calendar", "meeting", "inbox", "email", "organize", "filing"]],
  ["research",  ["research", "find", "lookup", "search", "gather", "collect", "compile", "sources"]],
  ["outreach",  ["outreach", "contact", "reach out", "prospect", "lead", "linkedin", "cold"]],
  ["design",    ["design", "graphic", "canva", "figma", "image", "banner", "logo", "visual"]],
  ["social",    ["social", "instagram", "facebook", "twitter", "post", "caption", "hashtag"]],
  ["technical", ["code", "technical", "website", "wordpress", "api", "integration", "script", "python"]],
  ["video",     ["video", "youtube", "edit", "clip", "reel", "transcribe", "transcript"]],
];

const CLUSTER_KEYWORDS = new Map(TYPE_CLUSTERS);

function resolveCluster(title: string): string {
  const low = title.toLowerCase();
  for (const [name, keywords] of TYPE_CLUSTERS) {
    if (keywords.some((kw) => low.includes(kw))) return name;
  }
  return "general";
}

// ── Risk thresholds ─────────────────────────────────────────────────────────
const WARN_REL = 75;
const WARN_CAP = 70;
const BLOCK_REL = 65;
const BLOCK_CAP = 80;

function riskLevel(reliability: number, capacity: number): "ok" | "warning" | "hard_block" {
  if (reliability < BLOCK_REL && capacity > BLOCK_CAP) return "hard_block";
  if (reliability < WARN_REL || capacity > WARN_CAP) return "warning";
  return "ok";
}

function escalateRisk(risk: "ok" | "warning" | "hard_block"): "warning" | "hard_block" {
  return risk === "hard_block" ? "hard_block" : "warning";
}

export async function GET(req: Request) {
  await requireAuth();
  const url = new URL(req.url);
  const title = url.searchParams.get("title") ?? "";
  const limit = Math.min(10, Math.max(1, parseInt(url.searchParams.get("limit") ?? "5")));

  const cluster = resolveCluster(title);

  // ── 1. Load all active VAs ───────────────────────────────────────────────
  const vas = await prisma.va.findMany({
    where: { active: true },
    select: {
      id: true,
      display_name: true,
      slack_user_id: true,
      reliability_score: true,
      capacity_index: true,
    },
  });

  if (vas.length === 0) {
    return NextResponse.json({ ok: true, task_cluster: cluster, title, recommendations: [] });
  }

  const vaIds = vas.map((v) => v.id);

  // ── 2. Adjusted reliability from scores_daily ────────────────────────────
  const relRows = await prisma.scoreDaily.findMany({
    where: {
      score_type: "adjusted_reliability",
      person_id: { in: vaIds },
    },
    orderBy: { day: "desc" },
    select: { person_id: true, score_value: true, day: true },
  });
  // Keep only the most-recent row per VA
  const adjRelMap = new Map<number, number>();
  for (const row of relRows) {
    if (row.person_id && !adjRelMap.has(row.person_id)) {
      adjRelMap.set(row.person_id, Number(row.score_value));
    }
  }

  // ── 3. Open VA-level interventions per VA ────────────────────────────────
  const openInterventions = await prisma.intervention.groupBy({
    by: ["target_person_id"],
    where: { level: "va", status: "open", target_person_id: { not: null } },
    _count: { id: true },
  });
  const ivnMap = new Map(
    openInterventions.map((r) => [r.target_person_id!, r._count.id])
  );

  // ── 4. Task-type match: last-30 TaskOwnership todos per VA ───────────────
  // Group by responsible_va_id, counting total and cluster-matching titles
  const clusterKeywords = CLUSTER_KEYWORDS.get(cluster) ?? [];
  let typeMatchMap = new Map<number, number>(); // va_id → score 0-100

  if (cluster !== "general") {
    // Load last 30 task_ownership records per VA
    const ownershipRows = await prisma.$queryRaw<
      { va_id: number; title: string | null }[]
    >`
      WITH ranked AS (
        SELECT
          tw.responsible_va_id AS va_id,
          t.title,
          ROW_NUMBER() OVER (PARTITION BY tw.responsible_va_id ORDER BY tw.assigned_at DESC) AS rn
        FROM task_ownership tw
        LEFT JOIN basecamp_todos t ON t.basecamp_todo_id = tw.todo_id
        WHERE tw.responsible_va_id = ANY(${vaIds})
          AND tw.active = TRUE
      )
      SELECT va_id, title FROM ranked WHERE rn <= 30
    `;

    // Count per VA: how many match cluster keywords
    const countMap = new Map<number, { total: number; matched: number }>();
    for (const row of ownershipRows) {
      const entry = countMap.get(row.va_id) ?? { total: 0, matched: 0 };
      entry.total++;
      const titleLow = (row.title ?? "").toLowerCase();
      if (clusterKeywords.some((kw) => titleLow.includes(kw))) entry.matched++;
      countMap.set(row.va_id, entry);
    }
    for (const [vaId, counts] of countMap) {
      typeMatchMap.set(vaId, counts.total > 0 ? Math.round((counts.matched / counts.total) * 100) : 50);
    }
  }

  // ── 5. VaLoadState throttle signals ─────────────────────────────────────
  const vaUuidMap = new Map<number, string>();
  for (const va of vas) {
    vaUuidMap.set(va.id, vaUuid(va.id));
  }
  const loadStates = await prisma.vaLoadState.findMany({
    where: { va_id: { in: Array.from(vaUuidMap.values()) } },
    select: { va_id: true, throttle_level: true, burnout_flag: true },
  });
  const loadStateMap = new Map(loadStates.map((s) => [s.va_id, s]));

  // ── 6. Score each VA ────────────────────────────────────────────────────
  const ENFORCE_HARD_BLOCK = process.env.MSP_ENFORCEMENT === "true";

  const scored = vas.map((va) => {
    const rel = adjRelMap.get(va.id) ?? va.reliability_score ?? 50;
    const cap = va.capacity_index ?? 50;
    const typeMatch = typeMatchMap.get(va.id) ?? 50;
    const skillMatch = 50; // neutral — no TaskClaim model

    // Python formula: composite = round(0.40*rel + 0.30*(100-cap) + 0.20*type + 0.10*skill)
    let composite = Math.round(0.40 * rel + 0.30 * (100 - cap) + 0.20 * typeMatch + 0.10 * skillMatch);

    let risk = riskLevel(rel, cap);
    const openIvn = ivnMap.get(String(va.id)) ?? 0;

    // Throttle adjustments
    const loadState = loadStateMap.get(vaUuidMap.get(va.id) ?? "");
    if (loadState) {
      if (loadState.throttle_level === "soft_throttle") {
        composite = Math.round(composite * 0.8);
        risk = escalateRisk(risk);
      } else if (loadState.throttle_level === "hard_throttle") {
        composite = Math.round(composite * 0.8);
        risk = ENFORCE_HARD_BLOCK ? "hard_block" : escalateRisk(risk);
      }
      if (loadState.burnout_flag) {
        risk = escalateRisk(risk);
      }
    }

    return {
      va_id: va.id,
      display_name: va.display_name,
      slack_user_id: va.slack_user_id,
      reliability_score: Math.round(rel),
      capacity_index: cap,
      open_interventions: openIvn,
      composite_score: Math.max(0, Math.min(100, composite)),
      risk,
      task_cluster: cluster,
    };
  });

  // Sort: ok first, then warning, then hard_block; within tier sort by composite desc
  scored.sort((a, b) => {
    const rankMap = { ok: 0, warning: 1, hard_block: 2 };
    const rDiff = rankMap[a.risk] - rankMap[b.risk];
    if (rDiff !== 0) return rDiff;
    return b.composite_score - a.composite_score;
  });

  return NextResponse.json({
    ok: true,
    task_cluster: cluster,
    title,
    recommendations: scored.slice(0, limit),
  });
}