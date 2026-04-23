/**
 * app/api/inngest/route.ts
 * Inngest serve endpoint — registers all functions with Inngest Cloud.
 */
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { basecampScrub } from "@/inngest/functions/basecamp-scrub";
import { dailyScoring } from "@/inngest/functions/daily-scoring";
import { syncBasecampPeople } from "@/inngest/functions/sync-basecamp-people";
import { vaWeeklyMetrics } from "@/inngest/functions/va-weekly-metrics";
import { opsWeeklyBrief } from "@/inngest/functions/ops-weekly-brief";
import { tbOpsDailyDigest, tbOpsWeeklyDigest } from "@/inngest/functions/tb-ops-digest";
import { vaBurnoutAlerts } from "@/inngest/functions/va-burnout-alerts";
import { dimScan } from "@/inngest/functions/dim-scan";
import { vaDailyPost } from "@/inngest/functions/va-daily-post";
import { mondaySummary } from "@/inngest/functions/monday-summary";
import { brainScan } from "@/inngest/functions/brain-scan";
import { playbookRebuild } from "@/inngest/functions/playbook-rebuild";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    basecampScrub,
    dailyScoring,
    syncBasecampPeople,
    vaWeeklyMetrics,
    opsWeeklyBrief,
    tbOpsDailyDigest,
    tbOpsWeeklyDigest,
    vaBurnoutAlerts,
    dimScan,
    vaDailyPost,
    mondaySummary,
    brainScan,
    playbookRebuild,
  ],
});