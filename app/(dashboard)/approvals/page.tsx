"use client";
import { useEffect, useState } from "react";
import { CheckCircle, XCircle, Loader2, RefreshCw, Clock } from "lucide-react";

type Entry = {
  id: number;
  customer_id: number;
  va_id: number | null;
  bucket_id: number | null;
  duration_minutes: number;
  description: string | null;
  status: string;
  start_time: string | null;
  end_time: string | null;
  basecamp_todo_id: string | null;
  created_at: string;
  approved_at: string | null;
};

export default function ApprovalsPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionMap, setActionMap] = useState<Record<number, string>>({});
  const [actionMsg, setActionMsg] = useState<Record<number, string>>({});

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/time-tracking?status=submitted&page_size=100");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setEntries(data.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function doAction(entryId: number, action: "approve" | "reject", reason?: string) {
    setActionMap((m) => ({ ...m, [entryId]: action }));
    setActionMsg((m) => ({ ...m, [entryId]: "" }));
    try {
      const body: Record<string, unknown> = {};
      if (action === "reject") body.reason = reason ?? "Rejected";
      const res = await fetch(`/api/time/${entryId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setActionMsg((m) => ({ ...m, [entryId]: action === "approve" ? "✓ Approved" : "✓ Rejected" }));
      // Remove from list after 1s
      setTimeout(() => {
        setEntries((prev) => prev.filter((e) => e.id !== entryId));
      }, 1000);
    } catch (err) {
      setActionMsg((m) => ({
        ...m,
        [entryId]: "✗ " + (err instanceof Error ? err.message : "Failed"),
      }));
    } finally {
      setActionMap((m) => {
        const next = { ...m };
        delete next[entryId];
        return next;
      });
    }
  }

  function handleReject(entryId: number) {
    const reason = prompt("Rejection reason:");
    if (reason !== null) doAction(entryId, "reject", reason);
  }

  function formatDuration(mins: number) {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-6 h-6 text-amber-500" />
          <h1 className="text-2xl font-bold text-gray-900">Time Entry Approvals</h1>
          {entries.length > 0 && (
            <span className="text-xs font-medium bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
              {entries.length} pending
            </span>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border shadow-sm p-12 flex items-center justify-center text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading…
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-white rounded-lg border shadow-sm p-12 text-center">
          <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
          <p className="text-gray-500">No pending time entries — inbox zero!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.id} className="bg-white rounded-lg border shadow-sm p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-semibold text-gray-800">
                      {formatDuration(entry.duration_minutes)}
                    </span>
                    <span className="text-xs text-gray-400">Entry #{entry.id}</span>
                    {entry.customer_id && (
                      <span className="text-xs text-gray-400">Customer #{entry.customer_id}</span>
                    )}
                    {entry.va_id && (
                      <span className="text-xs text-gray-400">VA #{entry.va_id}</span>
                    )}
                  </div>
                  {entry.description && (
                    <p className="text-sm text-gray-600">{entry.description}</p>
                  )}
                  {entry.basecamp_todo_id && (
                    <p className="text-xs text-gray-400">
                      Todo: <span className="font-mono">{entry.basecamp_todo_id}</span>
                    </p>
                  )}
                  <p className="text-xs text-gray-400">
                    Submitted {new Date(entry.created_at).toLocaleString()}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {actionMsg[entry.id] ? (
                    <span
                      className={`text-xs font-medium ${
                        actionMsg[entry.id].startsWith("✓") ? "text-emerald-600" : "text-red-600"
                      }`}
                    >
                      {actionMsg[entry.id]}
                    </span>
                  ) : (
                    <>
                      <button
                        onClick={() => doAction(entry.id, "approve")}
                        disabled={!!actionMap[entry.id]}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-md hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {actionMap[entry.id] === "approve" ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <CheckCircle className="w-3.5 h-3.5" />
                        )}
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(entry.id)}
                        disabled={!!actionMap[entry.id]}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-red-600 border border-red-300 text-sm rounded-md hover:bg-red-50 disabled:opacity-50"
                      >
                        {actionMap[entry.id] === "reject" ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5" />
                        )}
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
