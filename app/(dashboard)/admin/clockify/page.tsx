"use client";
import { useEffect, useState } from "react";
import { RefreshCw, Download, Loader2, CheckCircle, AlertCircle, Clock } from "lucide-react";

type SyncStatus = {
  ok: boolean;
  sync_logs: {
    entity_type: string;
    last_synced_at: string | null;
    entries_synced: number;
    status: string;
    error: string | null;
  }[];
  counts: Record<string, number>;
};

type ActionResult = {
  ok?: boolean;
  error?: string;
  summary?: Record<string, number>;
  duration_ms?: number;
  dry_run?: boolean;
};

export default function ClockifyAdminPage() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string>("");

  async function loadStatus() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/clockify/sync-status");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadStatus(); }, []);

  async function triggerAction(endpoint: string, label: string) {
    setActionLoading(label);
    setActionResult("");
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data: ActionResult = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      const summary = data.summary
        ? Object.entries(data.summary)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")
        : "";
      setActionResult(
        `✓ ${label} complete${summary ? ` — ${summary}` : ""}${data.duration_ms ? ` (${data.duration_ms}ms)` : ""}`
      );
      await loadStatus();
    } catch (err) {
      setActionResult(`✗ Error: ${err instanceof Error ? err.message : "Failed"}`);
    } finally {
      setActionLoading(null);
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString();
  }

  function statusBadge(s: string) {
    if (s === "success")
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
          <CheckCircle className="w-3 h-3" /> success
        </span>
      );
    if (s === "error")
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
          <AlertCircle className="w-3 h-3" /> error
        </span>
      );
    if (s === "never")
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
          <Clock className="w-3 h-3" /> never
        </span>
      );
    return (
      <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
        {s}
      </span>
    );
  }

  const cfConfigured = !!status || true; // show page regardless

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Clockify Integration</h1>
        <button
          onClick={loadStatus}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Sync Actions</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => triggerAction("/api/clockify/sync", "Incremental Sync")}
            disabled={!!actionLoading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {actionLoading === "Incremental Sync" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Incremental Sync
          </button>
          <button
            onClick={() => triggerAction("/api/clockify/import", "Full Import")}
            disabled={!!actionLoading}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-md hover:bg-emerald-700 disabled:opacity-50"
          >
            {actionLoading === "Full Import" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            Full Import
          </button>
        </div>
        {actionResult && (
          <p
            className={`text-sm ${
              actionResult.startsWith("✗") ? "text-red-600" : "text-emerald-600"
            }`}
          >
            {actionResult}
          </p>
        )}
      </div>

      {/* DB counts */}
      {status?.counts && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(status.counts).map(([key, val]) => (
            <div key={key} className="bg-white rounded-lg border shadow-sm p-4 text-center">
              <p className="text-2xl font-bold text-gray-900">{val.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-0.5 capitalize">{key.replace(/_/g, " ")}</p>
            </div>
          ))}
        </div>
      )}

      {/* Sync log table */}
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Recent Sync Logs</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Entity Type</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Status</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Entries Synced</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Last Synced</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                  Loading…
                </td>
              </tr>
            ) : !status?.sync_logs?.length ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  No sync history
                </td>
              </tr>
            ) : (
              status.sync_logs.map((log, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-800 capitalize">
                    {log.entity_type.replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-2.5">{statusBadge(log.status)}</td>
                  <td className="px-4 py-2.5 text-gray-600">{log.entries_synced.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-400">{formatDate(log.last_synced_at)}</td>
                  <td className="px-4 py-2.5 text-xs text-red-500 max-w-xs truncate">
                    {log.error ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
