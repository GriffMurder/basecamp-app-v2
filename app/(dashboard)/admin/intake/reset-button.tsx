"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

export function IntakeResetButton({ todoId }: { todoId: number }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleReset() {
    if (!confirm("Reset intake state for this todo? It will be re-evaluated on the next scan.")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/intake/${todoId}/reset`, { method: "POST" });
      if (res.ok) {
        setDone(true);
      } else {
        alert("Reset failed — see console.");
      }
    } catch (err) {
      console.error(err);
      alert("Reset failed — see console.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return <span className="text-xs text-emerald-600 font-medium">Reset ✓</span>;
  }

  return (
    <button
      onClick={handleReset}
      disabled={loading}
      className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 transition-colors disabled:opacity-50"
    >
      <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
      <span>Reset</span>
    </button>
  );
}