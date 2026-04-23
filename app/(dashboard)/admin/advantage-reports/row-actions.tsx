"use client";

import { useState } from "react";
import { CheckCircle, RotateCcw, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

interface Props {
  reportId: string;
  status: string;
}

export function ReportRowActions({ reportId, status }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<"render" | "retract" | null>(null);

  async function handleAction(action: "render" | "retract") {
    setLoading(action);
    try {
      const res = await fetch(`/api/admin/advantage-reports/${reportId}/${action}`, {
        method: "POST",
      });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      {status !== "rendered" && (
        <button
          onClick={() => handleAction("render")}
          disabled={loading !== null}
          title="Approve & Render"
          className="text-blue-600 hover:text-blue-800 disabled:opacity-40"
        >
          {loading === "render" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CheckCircle className="w-3.5 h-3.5" />
          )}
        </button>
      )}
      {status === "rendered" && (
        <button
          onClick={() => handleAction("retract")}
          disabled={loading !== null}
          title="Retract"
          className="text-gray-400 hover:text-red-500 disabled:opacity-40"
        >
          {loading === "retract" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RotateCcw className="w-3.5 h-3.5" />
          )}
        </button>
      )}
    </div>
  );
}