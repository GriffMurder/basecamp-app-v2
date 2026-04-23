"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Loader2, RotateCcw } from "lucide-react";

export function ResolveButton({
  threadId,
  isResolved,
}: {
  threadId: number;
  isResolved: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(isResolved);
  const router = useRouter();

  async function toggle() {
    setLoading(true);
    try {
      const action = done ? "unresolve" : "resolve";
      const res = await fetch(`/api/admin/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        setDone(data.resolved);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <span className="flex items-center gap-1 text-xs text-gray-400">
        <Loader2 className="w-3 h-3 animate-spin" />
      </span>
    );
  }

  if (done) {
    return (
      <button
        onClick={toggle}
        className="flex items-center gap-1 text-xs text-emerald-600 hover:text-gray-500 transition-colors"
        title="Click to un-resolve"
      >
        <CheckCircle className="w-3.5 h-3.5" />
        Resolved
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-1 text-xs text-gray-500 hover:text-emerald-600 font-medium transition-colors border border-gray-200 rounded px-2 py-0.5 hover:border-emerald-300 bg-white"
    >
      <CheckCircle className="w-3 h-3" />
      Resolve
    </button>
  );
}
