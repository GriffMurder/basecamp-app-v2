"use client";
import { useState } from "react";
import { Users, AlertTriangle, CheckCircle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type RecommendedVa = {
  va_id: number;
  display_name: string;
  slack_user_id: string | null;
  reliability_score: number;
  capacity_index: number;
  open_interventions: number;
  composite_score: number;
  risk: "ok" | "warning" | "hard_block";
  task_cluster: string;
};

type ApiResponse = {
  ok: boolean;
  task_cluster: string;
  title: string;
  recommendations: RecommendedVa[];
  error?: string;
};

const RISK_META = {
  ok: { label: "OK", cls: "bg-emerald-100 text-emerald-700", Icon: CheckCircle },
  warning: { label: "Warning", cls: "bg-amber-100 text-amber-700", Icon: AlertTriangle },
  hard_block: { label: "Hard Block", cls: "bg-red-100 text-red-700", Icon: AlertTriangle },
};

export function AssignRecommender({ title }: { title: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [results, setResults] = useState<ApiResponse | null>(null);

  async function load() {
    setState("loading");
    try {
      const res = await fetch(
        `/api/assign-recommend?title=${encodeURIComponent(title)}&limit=5`
      );
      const data: ApiResponse = await res.json();
      setResults(data);
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state === "idle") {
    return (
      <button
        onClick={load}
        className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
      >
        <Users className="w-4 h-4" />
        Recommend Assignee
      </button>
    );
  }

  if (state === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        Scoring VAs…
      </div>
    );
  }

  if (state === "error" || !results) {
    return <p className="text-sm text-red-500">Failed to load recommendations.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-500" />
          VA Recommendations
          <span className="font-normal text-gray-400 text-xs">cluster: {results.task_cluster}</span>
        </p>
        <button
          onClick={() => setState("idle")}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Close
        </button>
      </div>
      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 overflow-hidden">
        {results.recommendations.map((va, i) => {
          const meta = RISK_META[va.risk];
          const RiskIcon = meta.Icon;
          return (
            <div key={va.va_id} className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50">
              <span className="text-sm font-bold text-gray-400 w-4 shrink-0">#{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{va.display_name}</p>
                <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5 flex-wrap">
                  <span>Reliability: <span className="font-semibold text-gray-600">{va.reliability_score}</span></span>
                  <span>Capacity: <span className="font-semibold text-gray-600">{va.capacity_index}</span></span>
                  {va.open_interventions > 0 && (
                    <span className="text-amber-500">{va.open_interventions} open interventions</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm font-bold text-gray-700">{va.composite_score}</span>
                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${meta.cls}`}>
                  <RiskIcon className="w-3 h-3" />
                  {meta.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
