"use client";
import { useEffect, useState, useCallback } from "react";
import { BarChart2, Loader2, RefreshCw, PlusCircle, ChevronDown, ChevronUp } from "lucide-react";

type BriefSection = {
  summary?: string;
  signals?: string[];
  highlights?: unknown[];
  concerns?: unknown[];
  imbalances?: unknown[];
  notes?: string[];
};

type Brief = {
  id: number;
  week_start: string;
  generated_at: string;
  brief_json: {
    system_health?: BriefSection;
    va_performance?: BriefSection;
    client_risk?: BriefSection;
    demand_supply?: BriefSection;
    recommendations?: { title?: string; reasoning?: string; evidence?: string[] }[];
    questions?: string[];
    text?: string;
  };
  brief_text: string | null;
  model: string | null;
  prompt_version: string | null;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</h4>
      <div className="text-sm text-gray-700">{children}</div>
    </div>
  );
}

function BriefCard({ brief, defaultOpen }: { brief: Brief; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const bj = brief.brief_json ?? {};

  return (
    <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-gray-800">
            Week of {new Date(brief.week_start).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
          </span>
          {brief.model && (
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{brief.model}</span>
          )}
          <span className="text-xs text-gray-400">
            Generated {new Date(brief.generated_at).toLocaleString()}
          </span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-4">
          {/* Summary text */}
          {brief.brief_text && (
            <p className="text-sm text-gray-600 bg-gray-50 rounded p-3">{brief.brief_text}</p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* System Health */}
            {bj.system_health && (
              <Section title="System Health">
                <p className="font-mono text-xs text-gray-600">{bj.system_health.summary}</p>
                {(bj.system_health.signals ?? []).length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {(bj.system_health.signals ?? []).map((s, i) => (
                      <li key={i} className="text-xs text-gray-500">• {s}</li>
                    ))}
                  </ul>
                )}
              </Section>
            )}

            {/* Client Risk */}
            {bj.client_risk && (
              <Section title="Client Risk">
                {(bj.client_risk.signals ?? []).length > 0 && (
                  <ul className="space-y-0.5">
                    {(bj.client_risk.signals ?? []).map((s, i) => (
                      <li key={i} className="text-xs text-gray-500">• {s}</li>
                    ))}
                  </ul>
                )}
                {(bj.client_risk.notes ?? []).length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {(bj.client_risk.notes ?? []).map((n, i) => (
                      <li key={i} className="text-xs text-gray-500 italic">{n}</li>
                    ))}
                  </ul>
                )}
              </Section>
            )}

            {/* VA Performance */}
            {bj.va_performance && (
              <Section title="VA Performance">
                {(bj.va_performance.highlights ?? []).length > 0 ? (
                  <ul className="space-y-0.5">
                    {(bj.va_performance.highlights ?? []).map((h, i) => (
                      <li key={i} className="text-xs text-gray-600">{JSON.stringify(h)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-gray-400">No highlights</p>
                )}
                {(bj.va_performance.concerns ?? []).length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {(bj.va_performance.concerns ?? []).map((c, i) => (
                      <li key={i} className="text-xs text-amber-600">⚠ {JSON.stringify(c)}</li>
                    ))}
                  </ul>
                )}
              </Section>
            )}

            {/* Demand / Supply */}
            {bj.demand_supply && (
              <Section title="Demand / Supply">
                {(bj.demand_supply.notes ?? []).length > 0 && (
                  <ul className="space-y-0.5">
                    {(bj.demand_supply.notes ?? []).map((n, i) => (
                      <li key={i} className="text-xs text-gray-500">• {n}</li>
                    ))}
                  </ul>
                )}
                {(bj.demand_supply.imbalances ?? []).length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {(bj.demand_supply.imbalances ?? []).map((im, i) => (
                      <li key={i} className="text-xs text-amber-600">⚠ {JSON.stringify(im)}</li>
                    ))}
                  </ul>
                )}
              </Section>
            )}
          </div>

          {/* Recommendations */}
          {(bj.recommendations ?? []).length > 0 && (
            <Section title="Recommendations">
              <ul className="space-y-2">
                {(bj.recommendations ?? []).map((r, i) => (
                  <li key={i} className="bg-blue-50 rounded p-2">
                    {r.title && <p className="text-sm font-medium text-blue-800">{r.title}</p>}
                    {r.reasoning && <p className="text-xs text-blue-600 mt-0.5">{r.reasoning}</p>}
                    {(r.evidence ?? []).length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {(r.evidence ?? []).map((ev, j) => (
                          <li key={j} className="text-xs text-blue-500">• {ev}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Open Questions */}
          {(bj.questions ?? []).length > 0 && (
            <Section title="Open Questions">
              <ul className="space-y-0.5">
                {(bj.questions ?? []).map((q, i) => (
                  <li key={i} className="text-xs text-gray-500">? {q}</li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

export default function OpsBriefsPage() {
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [genMsg, setGenMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ops-briefs?page_size=12");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setBriefs(data.briefs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    setGenerating(true);
    setGenMsg("");
    try {
      const res = await fetch("/api/ops-briefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setGenMsg("✓ Brief generated");
      await load();
    } catch (err) {
      setGenMsg("✗ " + (err instanceof Error ? err.message : "Failed"));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-6 h-6 text-blue-500" />
          <h1 className="text-2xl font-bold text-gray-900">Weekly Ops Briefs</h1>
        </div>
        <div className="flex items-center gap-2">
          {genMsg && (
            <span className={`text-xs font-medium ${genMsg.startsWith("✓") ? "text-emerald-600" : "text-red-600"}`}>
              {genMsg}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={generate}
            disabled={generating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5" />}
            Generate Brief
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3">{error}</div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border shadow-sm p-12 flex items-center justify-center text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading briefs…
        </div>
      ) : briefs.length === 0 ? (
        <div className="bg-white rounded-lg border shadow-sm p-12 text-center">
          <BarChart2 className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500 mb-4">No ops briefs yet.</p>
          <button
            onClick={generate}
            disabled={generating}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            Generate First Brief
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {briefs.map((b, i) => (
            <BriefCard key={b.id} brief={b} defaultOpen={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}
