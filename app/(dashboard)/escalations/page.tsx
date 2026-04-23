"use client";
import { useEffect, useState, useCallback } from "react";
import { AlertTriangle, CheckCircle, Loader2, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";

type Intervention = {
  id: string;
  level: string;
  reason: string;
  target_person_id: string | null;
  customer_id: number | null;
  todo_id: string | null;
  status: string;
  created_at: string;
  sent_at: string | null;
  resolved_at: string | null;
  resolution_kind: string | null;
  root_cause_category: string | null;
  resolution_note: string | null;
  sla_due_at: string | null;
  sla_breached_at: string | null;
  parent_intervention_id: string | null;
};

const LEVEL_META: Record<string, { label: string; color: string; bgColor: string }> = {
  va:      { label: "VA",      color: "text-blue-700",   bgColor: "bg-blue-100" },
  manager: { label: "Manager", color: "text-amber-700",  bgColor: "bg-amber-100" },
  founder: { label: "Founder", color: "text-red-700",    bgColor: "bg-red-100" },
};

function LevelBadge({ level }: { level: string }) {
  const meta = LEVEL_META[level] ?? { label: level, color: "text-gray-700", bgColor: "bg-gray-100" };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${meta.bgColor} ${meta.color} uppercase tracking-wide`}>
      {meta.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "open"
      ? "bg-amber-100 text-amber-700"
      : status === "resolved"
      ? "bg-emerald-100 text-emerald-700"
      : status === "escalated"
      ? "bg-red-100 text-red-700"
      : "bg-gray-100 text-gray-500";
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls} capitalize`}>{status}</span>
  );
}

function SlaIndicator({ sla_due_at, sla_breached_at, status }: { sla_due_at: string | null; sla_breached_at: string | null; status: string }) {
  if (status === "resolved") return null;
  if (sla_breached_at) {
    return <span className="text-xs font-medium text-red-600">⚠ SLA Breached</span>;
  }
  if (sla_due_at) {
    const due = new Date(sla_due_at);
    const now = new Date();
    const hoursLeft = (due.getTime() - now.getTime()) / 3_600_000;
    if (hoursLeft < 0) return <span className="text-xs font-medium text-red-600">⚠ Past Due</span>;
    if (hoursLeft < 2) return <span className="text-xs font-medium text-amber-600">⏰ {hoursLeft.toFixed(1)}h left</span>;
    return <span className="text-xs text-gray-400">{hoursLeft.toFixed(1)}h SLA left</span>;
  }
  return null;
}

export default function EscalationsPage() {
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [resolving, setResolving] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page_size: "200" });
      if (filter !== "all") params.set("status", filter);
      if (levelFilter !== "all") params.set("level", levelFilter);
      const res = await fetch(`/api/interventions?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setInterventions(data.interventions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [filter, levelFilter]);

  useEffect(() => { load(); }, [load]);

  async function resolve(id: string) {
    const note = prompt("Resolution note (optional):");
    if (note === null) return; // cancelled
    setResolving((r) => ({ ...r, [id]: true }));
    try {
      const res = await fetch(`/api/interventions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "resolved", resolution_note: note || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setMsg((m) => ({ ...m, [id]: "✓ Resolved" }));
      setTimeout(() => setInterventions((prev) => prev.filter((i) => i.id !== id)), 800);
    } catch (err) {
      setMsg((m) => ({ ...m, [id]: "✗ " + (err instanceof Error ? err.message : "Failed") }));
    } finally {
      setResolving((r) => ({ ...r, [id]: false }));
    }
  }

  // Group by level
  const grouped: Record<string, Intervention[]> = { founder: [], manager: [], va: [] };
  for (const ivn of interventions) {
    if (!grouped[ivn.level]) grouped[ivn.level] = [];
    grouped[ivn.level].push(ivn);
  }

  const counts = { open: interventions.filter((i) => i.status === "open").length, total: interventions.length };

  const levelOrder = ["founder", "manager", "va"];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-6 h-6 text-amber-500" />
          <h1 className="text-2xl font-bold text-gray-900">Escalations</h1>
          {counts.open > 0 && (
            <span className="text-xs font-semibold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
              {counts.open} open
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Level filter */}
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white"
          >
            <option value="all">All Levels</option>
            <option value="founder">Founder</option>
            <option value="manager">Manager</option>
            <option value="va">VA</option>
          </select>
          {/* Status filter */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as "open" | "all")}
            className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white"
          >
            <option value="open">Open only</option>
            <option value="all">All statuses</option>
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3">{error}</div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border shadow-sm p-12 flex items-center justify-center text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
        </div>
      ) : interventions.length === 0 ? (
        <div className="bg-white rounded-lg border shadow-sm p-12 text-center">
          <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
          <p className="text-gray-500">No {filter === "open" ? "open " : ""}escalations — all clear!</p>
        </div>
      ) : (
        levelOrder.map((level) => {
          const rows = grouped[level] ?? [];
          if (rows.length === 0) return null;
          const meta = LEVEL_META[level];
          return (
            <div key={level} className="bg-white rounded-lg border shadow-sm overflow-hidden">
              <div className={`px-4 py-3 border-b ${meta.bgColor} flex items-center gap-2`}>
                <LevelBadge level={level} />
                <span className={`text-sm font-semibold ${meta.color}`}>{rows.length} intervention{rows.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="divide-y divide-gray-100">
                {rows.map((ivn) => {
                  const isExpanded = expanded[ivn.id];
                  return (
                    <div key={ivn.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <StatusBadge status={ivn.status} />
                            <span className="text-sm font-medium text-gray-800 capitalize">
                              {ivn.reason.replace(/_/g, " ")}
                            </span>
                            <SlaIndicator sla_due_at={ivn.sla_due_at} sla_breached_at={ivn.sla_breached_at} status={ivn.status} />
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                            {ivn.customer_id && (
                              <Link href={`/customers/${ivn.customer_id}`} className="text-blue-500 hover:underline">
                                Client #{ivn.customer_id}
                              </Link>
                            )}
                            {ivn.target_person_id && (
                              <span>Person: <span className="font-mono">{ivn.target_person_id}</span></span>
                            )}
                            {ivn.todo_id && (
                              <span>Todo: <span className="font-mono">{ivn.todo_id.substring(0, 12)}…</span></span>
                            )}
                            <span>{new Date(ivn.created_at).toLocaleString()}</span>
                          </div>
                          {isExpanded && (
                            <div className="mt-2 space-y-1 text-xs text-gray-500 bg-gray-50 rounded p-3">
                              {ivn.root_cause_category && <p>Root cause: <span className="font-medium">{ivn.root_cause_category}</span></p>}
                              {ivn.resolution_note && <p>Note: {ivn.resolution_note}</p>}
                              {ivn.resolution_kind && <p>Resolution: <span className="font-medium">{ivn.resolution_kind.replace(/_/g, " ")}</span></p>}
                              {ivn.resolved_at && <p>Resolved: {new Date(ivn.resolved_at).toLocaleString()}</p>}
                              {ivn.parent_intervention_id && <p>Parent: #{ivn.parent_intervention_id}</p>}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {msg[ivn.id] ? (
                            <span className={`text-xs font-medium ${msg[ivn.id].startsWith("✓") ? "text-emerald-600" : "text-red-600"}`}>
                              {msg[ivn.id]}
                            </span>
                          ) : ivn.status === "open" ? (
                            <button
                              onClick={() => resolve(ivn.id)}
                              disabled={resolving[ivn.id]}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {resolving[ivn.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                              Resolve
                            </button>
                          ) : null}
                          <Link
                            href={`/escalations/${ivn.id}`}
                            className="px-2.5 py-1 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
                          >
                            View
                          </Link>
                          <button
                            onClick={() => setExpanded((e) => ({ ...e, [ivn.id]: !e[ivn.id] }))}
                            className="p-1 text-gray-400 hover:text-gray-600"
                          >
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
