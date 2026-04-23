"use client";
import { useState } from "react";
import { Loader2, PlayCircle, CheckCircle, XCircle, Zap } from "lucide-react";

type TriggerResult = { ok?: boolean; triggered?: boolean; error?: string; [key: string]: unknown };

type Job = {
  id: string;
  label: string;
  description: string;
  endpoint: string;
  method: "GET" | "POST";
  body?: Record<string, unknown>;
  category: "cron" | "inngest" | "admin";
};

const JOBS: Job[] = [
  // Cron jobs (call the cron endpoints directly with CRON_SECRET)
  {
    id: "daily-ops",
    label: "Daily Ops Digest",
    description: "Fires tb/daily-ops.requested → TB Ops Slack digest + VA burnout check",
    endpoint: "/api/cron/daily-ops",
    method: "GET",
    category: "cron",
  },
  {
    id: "weekly-ops",
    label: "Weekly Ops Digest",
    description: "Fires tb/weekly-ops.requested → weekly Slack summary",
    endpoint: "/api/cron/weekly-ops",
    method: "GET",
    category: "cron",
  },
  {
    id: "daily-scoring",
    label: "Daily VA Scoring",
    description: "Computes reliability scores for all active VAs and writes ScoreDaily rows",
    endpoint: "/api/cron/daily-scoring",
    method: "GET",
    category: "cron",
  },
  {
    id: "overdue",
    label: "Overdue Monitor",
    description: "Checks overdue todos, creates VA intervention rows, DMs VAs",
    endpoint: "/api/cron/overdue",
    method: "GET",
    category: "cron",
  },
  {
    id: "sla",
    label: "SLA Enforcement",
    description: "Checks open interventions for SLA breaches, re-pings, escalates to founder",
    endpoint: "/api/cron/sla",
    method: "GET",
    category: "cron",
  },
  {
    id: "scrub",
    label: "Basecamp Scrub",
    description: "Pulls fresh todo data from Basecamp API, updates local DB",
    endpoint: "/api/cron/scrub",
    method: "GET",
    category: "cron",
  },
  {
    id: "sync-people",
    label: "Sync Basecamp People",
    description: "Syncs Basecamp people to the VA / Person tables",
    endpoint: "/api/cron/sync-people",
    method: "GET",
    category: "cron",
  },
  // Admin triggers
  {
    id: "clockify-sync",
    label: "Clockify Sync",
    description: "Triggers incremental Clockify import for projects, tags, and time entries",
    endpoint: "/api/clockify/sync",
    method: "POST",
    body: { mode: "incremental" },
    category: "admin",
  },
  {
    id: "ops-brief",
    label: "Generate Ops Brief",
    description: "Generates a deterministic weekly ops brief from current DB snapshot",
    endpoint: "/api/ops-briefs",
    method: "POST",
    body: {},
    category: "admin",
  },
  {
    id: "dim-scan",
    label: "DIM Integrity Scan",
    description: "Runs the nightly data integrity monitor now — detects stuck/stale/orphan todos",
    endpoint: "/api/cron/dim",
    method: "GET",
    category: "cron",
  },
  {
    id: "va-daily-post",
    label: "VA Daily Post",
    description: "Sends the daily broadcast to OPEN_TASKS_CHANNEL_ID with tips + yesterday's pulse",
    endpoint: "/api/cron/va-daily-post",
    method: "GET",
    category: "cron",
  },
  {
    id: "monday-summary",
    label: "Monday Weekly Summary",
    description: "Posts weekly ops summary to OPS_CHANNEL_ID: at-risk clients, quality signals, VA leaderboard",
    endpoint: "/api/cron/monday-summary",
    method: "GET",
    category: "cron",
  },
  {
    id: "brain-scan",
    label: "Brain Scan",
    description: "AI-generates job cards for unassigned todos and posts them to JOB_BOARD_CHANNEL_ID",
    endpoint: "/api/cron/brain-scan",
    method: "GET",
    category: "cron",
  },
  {
    id: "playbook-rebuild",
    label: "Client Playbook Rebuild",
    description: "Rebuilds ClientPlaybook records for all active clients from quality events + completion reports",
    endpoint: "/api/cron/playbook-rebuild",
    method: "GET",
    category: "cron",
  },
  {
    id: "va-personalized-nudges",
    label: "VA Personalized Nudges",
    description: "DMs each active VA their at-risk threads (needs TB reply for 4+ hours)",
    endpoint: "/api/cron/va-personalized-nudges",
    method: "GET",
    category: "cron",
  },
  {
    id: "va-snapshot",
    label: "VA Snapshot (Daily)",
    description: "Computes and upserts VaPerformanceSnapshot rows for all active VAs (last 24h)",
    endpoint: "/api/cron/va-snapshot",
    method: "GET",
    category: "cron",
  },
  {
    id: "escalation-reping",
    label: "Escalation Re-ping",
    description: "Re-pings stale manager escalations (>24h open); auto-escalates to founder after 48h",
    endpoint: "/api/cron/escalation-reping",
    method: "GET",
    category: "cron",
  },
  {
    id: "founder-alerts",
    label: "Founder Pattern Alerts",
    description: "Evaluates active managers for systemic patterns (SLA breaches, open escalations, at-risk clients) and DMs founder",
    endpoint: "/api/cron/founder-alerts",
    method: "GET",
    category: "cron",
  },
  {
    id: "overdue-monitor",
    label: "Overdue Monitor",
    description: "Scan for overdue or due-soon todos; create Interventions and DM responsible VAs",
    endpoint: "/api/cron/overdue-monitor",
    method: "GET",
    category: "cron",
  },
  {
    id: "response-nudges",
    label: "Response Nudges",
    description: "Detect customer comments awaiting TB reply; send timed nudges to VA (15m), manager (60m), ops (90m)",
    endpoint: "/api/cron/response-nudges",
    method: "GET",
    category: "cron",
  },
  {
    id: "acs-draft",
    label: "ACS Draft Generator",
    description: "Auto-draft completion summaries for recently completed todos that have no report yet",
    endpoint: "/api/cron/acs-draft",
    method: "GET",
    category: "cron",
  },
  {
    id: "score-compute",
    label: "Full Score Compute",
    description: "Compute VA reliability, capacity index, client health & difficulty scores",
    endpoint: "/api/cron/score-compute",
    method: "GET",
    category: "cron",
  },
  {
    id: "tier-compute",
    label: "Tier Auto-Compute",
    description: "Recompute effective tier (A/B/C) for all active customers",
    endpoint: "/api/cron/tier-compute",
    method: "GET",
    category: "cron",
  },
  {
    id: "system-heartbeat",
    label: "System Heartbeat",
    description: "Run a DB health check and DM founder if degraded/down",
    endpoint: "/api/cron/system-heartbeat",
    method: "GET",
    category: "cron",
  },
  {
    id: "va-overload-monitor",
    label: "VA Overload Monitor",
    description: "Assess VA WIP counts and quality dips, upsert va_load_state",
    endpoint: "/api/cron/va-overload-monitor",
    method: "GET",
    category: "cron",
  },
  {
    id: "manager-escalation",
    label: "Manager Escalation Scan",
    description: "Scan overdue todos for manager escalation triggers, post Slack alerts",
    endpoint: "/api/cron/manager-escalation",
    method: "GET",
    category: "cron",
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  cron: "Scheduled Jobs",
  inngest: "Inngest Functions",
  admin: "Admin Actions",
};

function TriggerButton({ job }: { job: Job }) {
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function trigger() {
    setState("loading");
    setMsg("");
    try {
      const opts: RequestInit = { method: job.method };
      if (job.method === "POST") {
        opts.headers = { "Content-Type": "application/json" };
        opts.body = JSON.stringify(job.body ?? {});
      }
      const res = await fetch(job.endpoint, opts);
      const data: TriggerResult = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState("error");
        setMsg(data.error ?? `HTTP ${res.status}`);
      } else {
        setState("ok");
        setMsg(JSON.stringify(data));
        setTimeout(() => setState("idle"), 4000);
      }
    } catch (err) {
      setState("error");
      setMsg(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <div className="bg-white rounded-lg border shadow-sm p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800 text-sm">{job.label}</p>
          <p className="text-xs text-gray-500 mt-0.5">{job.description}</p>
        </div>
        <button
          onClick={trigger}
          disabled={state === "loading"}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md shrink-0 disabled:opacity-50 transition-colors ${
            state === "ok" ? "bg-emerald-100 text-emerald-700" :
            state === "error" ? "bg-red-100 text-red-700" :
            "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          {state === "loading" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
           state === "ok" ? <CheckCircle className="w-3.5 h-3.5" /> :
           state === "error" ? <XCircle className="w-3.5 h-3.5" /> :
           <PlayCircle className="w-3.5 h-3.5" />}
          {state === "loading" ? "Running…" : state === "ok" ? "Done" : state === "error" ? "Failed" : "Run"}
        </button>
      </div>
      {msg && state !== "idle" && (
        <p className={`text-xs font-mono truncate ${state === "error" ? "text-red-600" : "text-gray-500"}`}>
          {msg}
        </p>
      )}
    </div>
  );
}

export default function TriggersPage() {
  const grouped = JOBS.reduce<Record<string, Job[]>>((acc, job) => {
    if (!acc[job.category]) acc[job.category] = [];
    acc[job.category].push(job);
    return acc;
  }, {});

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-2">
        <Zap className="w-6 h-6 text-amber-500" />
        <h1 className="text-2xl font-bold text-gray-900">Manual Triggers</h1>
      </div>
      <p className="text-sm text-gray-500 -mt-4">
        Manually fire scheduled jobs and admin actions. Cron jobs require a valid{" "}
        <code className="bg-gray-100 px-1 rounded">CRON_SECRET</code> — they will return 401 if the server
        requires authentication (call from Vercel Cron or set the header manually).
      </p>

      {(["cron", "admin"] as const).map((cat) => (
        <div key={cat} className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{CATEGORY_LABELS[cat]}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(grouped[cat] ?? []).map((job) => (
              <TriggerButton key={job.id} job={job} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
