/**
 * Client Playbook Builder — nightly rebuild for all active clients
 *
 * For each active customer with a Basecamp project ID:
 *   1. Count recent quality events (praise, revision, negative_feedback, vague_request)
 *   2. Collect top task types from completion reports
 *   3. Compute risk flags (high revision rate, slow responder)
 *   4. Detect recurring task title patterns
 *   5. Upsert ClientPlaybook row (playbook_json + signals_json + top_rules)
 *
 * Runs nightly at 03:00 UTC + on-demand via event `tb/playbook-rebuild.requested`.
 */
import { inngest } from "../client";
import { prisma } from "@/lib/prisma";

// Artifact keyword detection for preferred_artifacts signal
const ARTIFACT_KEYWORDS: [string, string[]][] = [
  ["google_sheet", ["sheet", "spreadsheet", "gsheet"]],
  ["hubspot", ["hubspot", "crm", "contact record", "deal record"]],
  ["doc", ["doc", "document", "google doc", "notion", "word"]],
  ["email", ["email", "draft email", "message", "outreach"]],
  ["basecamp_comment", ["basecamp", "bc comment", "posted to"]],
];

function detectArtifacts(texts: string[]): string[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    const low = text.toLowerCase();
    for (const [artifact, keywords] of ARTIFACT_KEYWORDS) {
      if (keywords.some((kw) => low.includes(kw))) {
        counts.set(artifact, (counts.get(artifact) ?? 0) + 1);
      }
    }
  }
  if (counts.size === 0) return ["unknown"];
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);
}

export const playbookRebuild = inngest.createFunction(
  {
    id: "client-playbook-rebuild",
    name: "Client Playbook: Nightly Rebuild",
    concurrency: { limit: 1 },
  },
  [{ cron: "0 3 * * *" }, { event: "tb/playbook-rebuild.requested" }],
  async ({ step }) => {
    // Fetch all active customers with a Basecamp project
    const customers = await step.run("fetch-active-customers", async () => {
      return prisma.customer.findMany({
        where: {
          active: true,
          basecamp_project_id: { not: null },
        },
        select: {
          id: true,
          name: true,
          basecamp_project_id: true,
        },
        take: 200,
      });
    });

    if (customers.length === 0) {
      return { ok: true, processed: 0 };
    }

    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60-day lookback
    let processed = 0;
    let errors = 0;

    for (const customer of customers) {
      await step.run(`build-playbook-${customer.id}`, async () => {
        try {
          await buildPlaybookForCustomer(customer.id, customer.basecamp_project_id!, since);
          processed++;
        } catch {
          errors++;
        }
      });
    }

    return { ok: true, processed, errors, total: customers.length };
  }
);

async function buildPlaybookForCustomer(
  customerId: number,
  basecampProjectId: string,
  since: Date
) {
  // ── Quality events ────────────────────────────────────────────────────────
  const qualityEvents = await prisma.taskQualityEvent.groupBy({
    by: ["event_type"],
    where: { created_at: { gte: since } },
    _count: { id: true },
  });
  const eventMap = new Map(qualityEvents.map((e) => [e.event_type, e._count.id]));

  const praiseCount = eventMap.get("praise") ?? 0;
  const revisionCount = eventMap.get("revision") ?? 0;
  const negativeFeedbackCount = eventMap.get("negative_feedback") ?? 0;
  const vagueRequestCount = eventMap.get("vague_request") ?? 0;
  const totalEvents = praiseCount + revisionCount + negativeFeedbackCount + vagueRequestCount;

  // ── Completion reports for this customer ─────────────────────────────────
  const completionReports = await prisma.taskCompletionReport.findMany({
    where: {
      client_id: String(customerId),
      status: { in: ["approved", "posted"] },
      created_at: { gte: since },
    },
    select: { task_type: true, draft_report: true },
    take: 50,
  });

  // Task type counts
  const taskTypeCounts = new Map<string, number>();
  for (const r of completionReports) {
    if (r.task_type) {
      taskTypeCounts.set(r.task_type, (taskTypeCounts.get(r.task_type) ?? 0) + 1);
    }
  }
  const topTaskTypes = [...taskTypeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([task_type, count]) => ({ task_type, count }));

  // Artifact detection from report texts
  const reportTexts = completionReports
    .flatMap((r) => {
      const d = r.draft_report as Record<string, unknown> | null;
      if (!d) return [];
      const items = Array.isArray(d.what_was_done) ? (d.what_was_done as string[]) : [];
      return items;
    })
    .filter(Boolean);
  const preferredArtifacts = detectArtifacts(reportTexts);

  // Delivery format: prefer bullets if most reports have ≥3 items
  let bulletCount = 0;
  let paraCount = 0;
  for (const r of completionReports) {
    const d = r.draft_report as Record<string, unknown> | null;
    const items = Array.isArray(d?.what_was_done) ? (d?.what_was_done as string[]) : [];
    if (items.length >= 3) bulletCount++;
    else if (items.length === 1 && items[0].length > 120) paraCount++;
    else bulletCount++;
  }
  const deliveryFormat =
    bulletCount === 0 && paraCount === 0
      ? "unknown"
      : bulletCount > 0 && paraCount > 0
      ? "mixed"
      : bulletCount >= paraCount
      ? "bullets"
      : "paragraph";

  // ── Recurring task titles ─────────────────────────────────────────────────
  const recentTodos = await prisma.basecampTodo.findMany({
    where: {
      basecamp_project_id: basecampProjectId,
      seen_at: { gte: since },
      title: { not: null },
    },
    select: { title: true },
    take: 100,
  });
  const titleCounts = new Map<string, number>();
  for (const t of recentTodos) {
    if (!t.title) continue;
    const normalized = t.title.trim().toLowerCase().slice(0, 80);
    titleCounts.set(normalized, (titleCounts.get(normalized) ?? 0) + 1);
  }
  const recurringTasks = [...titleCounts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([title, count]) => ({ title, count }));

  // ── Risk flags ────────────────────────────────────────────────────────────
  const revisionRate = totalEvents > 0 ? revisionCount / totalEvents : 0;
  const highRevisionRate = revisionRate >= 0.25;
  const vagueRequests = vagueRequestCount >= 3;

  // Slow responder: avg days from todo creation to completion in last 60d
  const completedTodos = await prisma.basecampTodo.findMany({
    where: {
      basecamp_project_id: basecampProjectId,
      completed: true,
      completed_at: { gte: since },
      created_at: { gte: new Date("2000-01-01") },
    },
    select: { created_at: true, completed_at: true },
    take: 30,
  });
  let slowResponder = false;
  if (completedTodos.length >= 3) {
    const avgDays =
      completedTodos.reduce((sum, t) => {
        if (!t.completed_at || !t.created_at) return sum;
        return sum + (t.completed_at.getTime() - t.created_at.getTime()) / (1000 * 60 * 60 * 24);
      }, 0) / completedTodos.length;
    slowResponder = avgDays > 5;
  }

  // ── Build top_rules ───────────────────────────────────────────────────────
  const topRules: string[] = [];
  if (deliveryFormat === "bullets") topRules.push("Prefer bullet-point deliverables");
  if (deliveryFormat === "paragraph") topRules.push("Prefer paragraph-form deliverables");
  if (preferredArtifacts[0] && preferredArtifacts[0] !== "unknown") {
    topRules.push(`Primary artifact: ${preferredArtifacts[0].replace(/_/g, " ")}`);
  }
  if (highRevisionRate) topRules.push("High revision rate — clarify requirements before starting");
  if (vagueRequests) topRules.push("Client frequently submits vague requests — always ask clarifying questions");
  if (slowResponder) topRules.push("Client is a slow responder — set realistic timelines");

  // ── Upsert playbook ───────────────────────────────────────────────────────
  const playbook_json = {
    preferences: {
      delivery_format: deliveryFormat,
      preferred_artifacts: preferredArtifacts,
    },
    recurring_work: {
      top_task_types: topTaskTypes,
      recurring_tasks: recurringTasks,
    },
    risk_flags: {
      high_revision_rate: highRevisionRate,
      vague_requests: vagueRequests,
      slow_responder: slowResponder,
    },
  };

  const signals_json = {
    report_count: completionReports.length,
    revision_count: revisionCount,
    revision_rate: Math.round(revisionRate * 100) / 100,
    praise_count: praiseCount,
    negative_feedback_count: negativeFeedbackCount,
    vague_request_count: vagueRequestCount,
    last_activity_at: since.toISOString(),
  };

  await prisma.clientPlaybook.upsert({
    where: { client_id: String(customerId) },
    create: {
      client_id: String(customerId),
      playbook_json,
      top_rules: topRules,
      signals_json,
      last_built_at: new Date(),
    },
    update: {
      playbook_json,
      top_rules: topRules,
      signals_json,
      last_built_at: new Date(),
    },
  });
}
