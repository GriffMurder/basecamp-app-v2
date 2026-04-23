/**
 * inngest/functions/project-activity-sync.ts
 *
 * Port of app/project_activity_sync.py
 *
 * Syncs Basecamp project-level activities (messages, documents, uploads,
 * comments) that happen outside individual todo threads.
 *
 * Each event is logged as an Interaction row. Deduped via external_id in
 * the payload JSON (no unique DB constraint, so we skip if already found).
 *
 * Author classification:
 *   internal = basecamp_person_id in BASECAMP_INTERNAL_PERSON_IDS (env CSV)
 *   client   = not internal
 *
 * Cron: every hour
 * Also fires on: tb/project-activity-sync.requested
 *
 * Env:
 *   BASECAMP_INTERNAL_PERSON_IDS — comma-separated Basecamp person IDs
 *   BASECAMP_QC_PERSON_ID        — system/QC account person ID
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { listProjectEvents } from "@/lib/basecamp";
import { randomUUID } from "crypto";

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripHtml(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/<[^>]+>/g, "").trim();
}

function isInternalPerson(personId: string | number | null | undefined): boolean {
  if (!personId) return false;
  const pid = String(personId);
  const internalIds = (process.env.BASECAMP_INTERNAL_PERSON_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (internalIds.includes(pid)) return true;
  const qcId = process.env.BASECAMP_QC_PERSON_ID;
  if (qcId && pid === String(qcId)) return true;
  return false;
}

// ── Inngest function ──────────────────────────────────────────────────────────

export const projectActivitySync = inngest.createFunction(
  {
    id: "project-activity-sync",
    name: "Project Activity Sync",
    concurrency: { limit: 1 },
  },
  [
    { cron: "0 * * * *" }, // Hourly
    { event: "tb/project-activity-sync.requested" },
  ],
  async ({ step, logger }) => {
    const now = new Date();
    const since = new Date(now.getTime() - 60 * 60 * 1000).toISOString(); // 1 hour ago

    // ── Load active customers with Basecamp project IDs ───────────────────
    const customers = await step.run("load-customers", async () => {
      return prisma.customer.findMany({
        where: {
          active: true,
          basecamp_project_id: { not: null },
        },
        select: { id: true, name: true, basecamp_project_id: true },
      });
    });

    if (!customers.length) {
      logger.info("project-activity-sync: no active customers");
      return { projectsScanned: 0, eventsFound: 0, logged: 0, errors: 0 };
    }

    logger.info(`project-activity-sync: scanning ${customers.length} projects`);

    let projectsScanned = 0;
    let eventsFound = 0;
    let logged = 0;
    let errors = 0;

    for (const customer of customers) {
      if (!customer.basecamp_project_id) continue;
      const projectId = parseInt(customer.basecamp_project_id, 10);
      if (isNaN(projectId)) continue;

      await step.run(`sync-project-${customer.id}`, async () => {
        projectsScanned++;
        let events: Awaited<ReturnType<typeof listProjectEvents>> = [];

        try {
          events = await listProjectEvents(projectId, since);
        } catch (err) {
          logger.warn(`project-activity-sync: fetch failed for project ${projectId}: ${err}`);
          errors++;
          return;
        }

        eventsFound += events.length;

        for (const event of events) {
          try {
            const recordingId = event.id;
            const extId = `bc:project_event:${recordingId}`;

            // Skip if already logged
            const existing = await prisma.interaction.findFirst({
              where: {
                payload: { path: ["external_id"], equals: extId },
              },
              select: { id: true },
            });
            if (existing) continue;

            const content = stripHtml(event.content ?? event.excerpt);
            const creatorId = event.creator?.id ?? null;
            const internal = isInternalPerson(creatorId);
            const isClient = !internal;

            const happenedAt = event.created_at
              ? new Date(event.created_at)
              : now;

            await prisma.interaction.create({
              data: {
                id:               randomUUID(),
                source:           "basecamp",
                customer_id:      customer.id,
                interaction_type: `project_${event.type.toLowerCase()}`,
                happened_at:      happenedAt,
                payload: {
                  external_id:       extId,
                  recording_id:      String(recordingId),
                  event_type:        event.type.toLowerCase(),
                  project_id:        String(projectId),
                  text_len:          content.length,
                  is_internal:       internal,
                  is_client:         isClient,
                  is_project_level:  true,
                  creator_id:        creatorId ? String(creatorId) : null,
                  creator_name:      event.creator?.name ?? null,
                },
              },
            });
            logged++;
          } catch (err) {
            logger.warn(
              `project-activity-sync: error logging event ${event.id} for project ${projectId}: ${err}`
            );
            errors++;
          }
        }
      });
    }

    logger.info(
      `project-activity-sync done: projectsScanned=${projectsScanned} ` +
      `eventsFound=${eventsFound} logged=${logged} errors=${errors}`
    );

    return { projectsScanned, eventsFound, logged, errors };
  }
);
