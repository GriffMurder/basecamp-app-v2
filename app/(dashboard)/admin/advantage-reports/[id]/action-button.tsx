"use client";

import { useState } from "react";
import { CheckCircle, RotateCcw, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

type Action = "render" | "retract";
type Variant = "primary" | "ghost";

interface Props {
  reportId: string;
  action: Action;
  label: string;
  icon: "check" | "undo";
  variant: Variant;
}

export function ReportActionButton({ reportId, action, label, icon, variant }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/advantage-reports/${reportId}/${action}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  const Icon = loading ? Loader2 : icon === "check" ? CheckCircle : RotateCcw;
  const baseClass = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50";
  const variantClass = variant === "primary"
    ? "bg-blue-600 text-white hover:bg-blue-700"
    : "border border-gray-300 text-gray-600 hover:bg-gray-50";

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={handleClick}
        disabled={loading}
        className={`${baseClass} ${variantClass}`}
      >
        <Icon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        {label}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}