"use client";

import { useState } from "react";
import { CheckCircle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

export default function ApproveButton({ reportId }: { reportId: string }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function approve() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${reportId}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setDone(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <span className="flex items-center gap-1 text-sm text-emerald-600 font-medium">
        <CheckCircle className="w-4 h-4" /> Approved
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <button
        onClick={approve}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
        Approve Draft
      </button>
    </div>
  );
}
