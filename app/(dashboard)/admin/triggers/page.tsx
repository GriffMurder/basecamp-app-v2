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
