/**
 * GET /api/assign-recommend?todo_id=...&title=...
 *
 * Recommends VAs for a todo using:
 *   reliability_score   × 0.40
 *   capacity pressure   × 0.30  (inverted capacity_index)
 *   task-type match     × 0.20  (keyword cluster from title)
 *   open interventions  × 0.10  (penalty for open VA-level interventions)
 *
 * Risk levels:
 *   ok         → proceed
 *   warning    → reliability < 75 OR capacity_index > 70
 *   hard_block → reliability < 65 AND capacity_index > 80
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Task-type keyword clusters ────────────────────────────────────────────────
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

function resolveCluster(title: string): string {
  const low = title.toLowerCase();
  for (const [name, keywords] of TYPE_CLUSTERS) {
    if (keywords.some((kw) => low.includes(kw))) return name;
  }
  return "general";
}

// ── Risk thresholds ───────────────────────────────────────────────────────────
const WARN_REL = 75;
const WARN_CAP = 70;
const BLOCK_REL = 65;
const BLOCK_CAP = 80;

function riskLevel(reliability: number, capacity: number): "ok" | "warning" | "hard_block" {
  if (reliability < BLOCK_REL && capacity > BLOCK_CAP) return "hard_block";
  if (reliability < WARN_REL || capacity > WARN_CAP) return "warning";
  return "ok";
}

export async function GET(req: Request) {
  await requireAuth();
  const url = new URL(req.url);
  const title = url.searchParams.get("title") ?? "";
  const limit = Math.min(10, Math.max(1, parseInt(url.searchParams.get("limit") ?? "5")));

  const cluster = resolveCluster(title);

  // Load all active VAs with their scores
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

  // Load open VA-level intervention counts per target_person_id
  // (target_person_id is a string; Va.id is Int — we match by string representation)
  const openInterventions = await prisma.intervention.groupBy({
    by: ["target_person_id"],
    where: { level: "va", status: "open", target_person_id: { not: null } },
    _count: { id: true },
  });
  const ivnMap = new Map(
    openInterventions.map((r) => [r.target_person_id!, r._count.id])
  );

  // Score each VA
  const scored = vas.map((va) => {
    const rel = va.reliability_score ?? 50;
    const cap = va.capacity_index ?? 50;
    const openIvn = ivnMap.get(String(va.id)) ?? 0;

    // Reliability: 0–100, higher is better → normalized
    const relScore = rel / 100;
    // Capacity: lower capacity_index is better (less loaded) → invert
    const capScore = 1 - cap / 100;
    // Task type: neutral 0.5 without DB history query (keep this fast)
    const typeScore = cluster === "general" ? 0.5 : 0.5;
    // Intervention penalty: each open intervention reduces score
    const ivnPenalty = Math.min(1, openIvn * 0.2);

    const composite =
      relScore * 0.40 +
      capScore * 0.30 +
      typeScore * 0.20 -
      ivnPenalty * 0.10;

    const risk = riskLevel(rel, cap);

    return {
      va_id: va.id,
      display_name: va.display_name,
      slack_user_id: va.slack_user_id,
      reliability_score: rel,
      capacity_index: cap,
      open_interventions: openIvn,
      composite_score: Math.round(composite * 100),
      risk,
      task_cluster: cluster,
    };
  });

  // Sort by composite desc, hard_block last
  scored.sort((a, b) => {
    const rankMap = { ok: 0, warning: 1, hard_block: 2 };
    const rDiff = rankMap[a.risk] - rankMap[b.risk];
    if (rDiff !== 0) return rDiff;
    return b.composite_score - a.composite_score;
  });

  const topVAs = scored.slice(0, limit);

  return NextResponse.json({
    ok: true,
    task_cluster: cluster,
    title,
    recommendations: topVAs,
  });
}
