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
import { vaPersonalizedNudges } from "@/inngest/functions/va-personalized-nudges";
import { vaSnapshotDaily, vaSnapshotWeekly } from "@/inngest/functions/va-snapshot";
import { escalationReping } from "@/inngest/functions/escalation-reping";
import { founderAlerts } from "@/inngest/functions/founder-alerts";
import { overdueMonitor } from "@/inngest/functions/overdue-monitor";
import { responseNudges } from "@/inngest/functions/response-nudges";
import { acsDraft } from "@/inngest/functions/acs-draft";
import { scoreCompute } from "@/inngest/functions/score-compute";
import { tierCompute } from "@/inngest/functions/tier-compute";
import { systemHeartbeat } from "@/inngest/functions/system-heartbeat";
import { vaOverloadMonitor } from "@/inngest/functions/va-overload-monitor";
import { managerEscalation } from "@/inngest/functions/manager-escalation";
import { qualityScan } from "@/inngest/functions/quality-scan";
import { projectActivitySync } from "@/inngest/functions/project-activity-sync";
import { carBuilder } from "@/inngest/functions/car-builder";
import { advantageReportBuilder } from "@/inngest/functions/advantage-report-builder";
import { sentimentScan } from "@/inngest/functions/sentiment-scan";
import { acsPost } from "@/inngest/functions/acs-post";
import { advantageReportSender } from "@/inngest/functions/advantage-report-sender";

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
    vaPersonalizedNudges,
    vaSnapshotDaily,
    vaSnapshotWeekly,
    escalationReping,
    founderAlerts,
    overdueMonitor,
    responseNudges,
    acsDraft,
    scoreCompute,
    tierCompute,
    systemHeartbeat,
    vaOverloadMonitor,
    managerEscalation,
    qualityScan,
    projectActivitySync,
    carBuilder,
    advantageReportBuilder,
    sentimentScan,
    acsPost,
    advantageReportSender,
  ],
});