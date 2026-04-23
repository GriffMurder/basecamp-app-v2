"use client";
import { useEffect, useState, useCallback } from "react";
import { FileText, Loader2, RefreshCw, ChevronDown, ChevronUp, CheckCircle } from "lucide-react";

type SuccessPlan = {
  id: string;
  basecamp_thread_id: string;
  task_type_suggested: string;
  task_type_final: string | null;
  status: string;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  generated_plan: {
    goal?: string;
    definition_of_done?: string[];
    required_elements?: string[];
    quality_checks?: string[];
    output_location?: string;
    suggested_next_step?: string;
  };
  va_modified_plan: Record<string, unknown> | null;
};

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "confirmed" ? "bg-emerald-100 text-emerald-700" :
    status === "generated" ? "bg-blue-100 text-blue-700" :
    "bg-gray-100 text-gray-500";
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls} capitalize`}>{status}</span>
  );
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-mono">{type}</span>
  );
}

function PlanDetail({ plan }: { plan: SuccessPlan }) {
  const gp = plan.generated_plan ?? {};
  const mp = (plan.va_modified_plan as typeof gp | null);
  const active = mp ?? gp;

  return (
    <div className="mt-2 space-y-3 text-sm bg-gray-50 rounded p-4">
      {plan.va_modified_plan && (
        <p className="text-xs text-amber-600 font-medium">⚠ VA has modified this plan</p>
      )}
      {active.goal && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Goal</p>
          <p className="text-gray-700">{active.goal}</p>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(active.definition_of_done ?? []).length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Definition of Done</p>
            <ul className="space-y-0.5">
              {(active.definition_of_done ?? []).map((item, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-gray-600">
                  <CheckCircle className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" /> {item}
                </li>
              ))}
            </ul>
          </div>
        )}
        {(active.required_elements ?? []).length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Required Elements</p>
            <ul className="space-y-0.5">
              {(active.required_elements ?? []).map((item, i) => (
                <li key={i} className="text-xs text-gray-600">• {item}</li>
              ))}
            </ul>
          </div>
        )}
        {(active.quality_checks ?? []).length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Quality Checks</p>
            <ul className="space-y-0.5">
              {(active.quality_checks ?? []).map((item, i) => (
                <li key={i} className="text-xs text-gray-600">• {item}</li>
              ))}
            </ul>
          </div>
        )}
        {(active.output_location || active.suggested_next_step) && (
          <div className="space-y-2">
            {active.output_location && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Output Location</p>
                <p className="text-xs text-gray-600">{active.output_location}</p>
              </div>
            )}
            {active.suggested_next_step && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Next Step</p>
                <p className="text-xs text-gray-600">{active.suggested_next_step}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PlansPage() {
  const [plans, setPlans] = useState<SuccessPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page_size: "100" });
      if (status !== "all") params.set("status", status);
      const res = await fetch(`/api/plans?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setPlans(data.plans ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const counts = { confirmed: plans.filter((p) => p.status === "confirmed").length, generated: plans.filter((p) => p.status === "generated").length };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <FileText className="w-6 h-6 text-blue-500" />
          <h1 className="text-2xl font-bold text-gray-900">Success Plans</h1>
          <span className="text-sm text-gray-400">{total} total</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white"
          >
            <option value="all">All statuses</option>
            <option value="generated">Generated</option>
            <option value="confirmed">Confirmed</option>
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

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Plans", value: total },
          { label: "Confirmed", value: counts.confirmed },
          { label: "Pending Confirmation", value: counts.generated },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-lg border shadow-sm p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3">{error}</div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border shadow-sm p-12 flex items-center justify-center text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
        </div>
      ) : plans.length === 0 ? (
        <div className="bg-white rounded-lg border shadow-sm p-12 text-center">
          <FileText className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500">No success plans found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="divide-y divide-gray-100">
            {plans.map((plan) => (
              <div key={plan.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={plan.status} />
                      <TypeBadge type={plan.task_type_final ?? plan.task_type_suggested} />
                      <span className="font-mono text-xs text-gray-500 truncate">{plan.basecamp_thread_id.substring(0, 24)}…</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <span>Created {new Date(plan.created_at).toLocaleDateString()}</span>
                      {plan.confirmed_at && (
                        <span className="text-emerald-600">✓ Confirmed {new Date(plan.confirmed_at).toLocaleDateString()}</span>
                      )}
                      {plan.va_modified_plan && (
                        <span className="text-amber-500">✏ VA-modified</span>
                      )}
                    </div>
                    {plan.generated_plan?.goal && (
                      <p className="text-sm text-gray-700 truncate">{plan.generated_plan.goal}</p>
                    )}
                    {expanded[plan.id] && <PlanDetail plan={plan} />}
                  </div>
                  <button
                    onClick={() => setExpanded((e) => ({ ...e, [plan.id]: !e[plan.id] }))}
                    className="p-1 text-gray-400 hover:text-gray-600 shrink-0"
                  >
                    {expanded[plan.id] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
