/**
 * inngest/functions/sync-basecamp-people.ts
 * Replaces Celery tasks: sync_basecamp_people_daily (2:00am) + sync_people_slack_ids_daily (2:15am)
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { findUserByEmail } from "@/lib/slack";

export const syncBasecampPeople = inngest.createFunction(
  { id: "sync-basecamp-people", name: "Sync Basecamp People", concurrency: 1 },
  { cron: "0 2 * * *" },
  async ({ step, logger }) => {
    logger.info("Starting Basecamp people sync");

    const accountId = process.env.BASECAMP_ACCOUNT_ID;
    const token = process.env.BASECAMP_TOKEN;
    if (!accountId || !token) {
      logger.warn("BASECAMP_ACCOUNT_ID or BASECAMP_TOKEN not set — skipping");
      return { synced: 0 };
    }

    const bcPeople = await step.run("fetch-bc-people", async () => {
      const res = await fetch(
        `https://3.basecampapi.com/${accountId}/people.json`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": `TaskBullet-Ops/1.0 (${process.env.NEXT_PUBLIC_APP_URL ?? ""})`,
          },
        }
      );
      if (!res.ok) throw new Error(`Basecamp people fetch: ${res.status}`);
      return res.json() as Promise<
        { id: number; name: string; email_address: string }[]
      >;
    });

    let synced = 0;
    for (const person of bcPeople) {
      if (!person.email_address) continue;
      await step.run(`upsert-person-${person.id}`, async () => {
        await prisma.person.upsert({
          where: { email: person.email_address },
          create: {
            display_name: person.name,
            email: person.email_address,
            basecamp_person_id: String(person.id),
            role: "va",
          },
          update: {
            display_name: person.name,
            basecamp_person_id: String(person.id),
          },
        });
        synced++;
      });
    }

    // Match Slack IDs for people who don't have one yet
    const peopleWithoutSlack = await step.run("load-people-without-slack", () =>
      prisma.person.findMany({
        where: { slack_user_id: null, email: { not: null } },
        select: { id: true, email: true },
      })
    );

    let slackSynced = 0;
    for (const person of peopleWithoutSlack) {
      if (!person.email) continue;
      const slackUser = await findUserByEmail(person.email).catch(() => null);
      if (!slackUser) continue;
      await prisma.person.update({
        where: { id: person.id },
        data: { slack_user_id: slackUser.id },
      });
      slackSynced++;
    }

    logger.info(`People sync: ${synced} upserted, ${slackSynced} Slack IDs matched`);
    return { synced, slackSynced };
  }
);