import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { FileText, ChevronDown } from "lucide-react";

export const dynamic = "force-dynamic";

type ScorecardJson = {
  summary?: string;
  strengths?: Array<{ title: string; reasoning?: string; evidence?: string[] }>;
  weaknesses?: Array<{ title: string; reasoning?: string; evidence?: string[] }>;
  risks?: string[];
  recommendations?: Array<{ title: string; reasoning?: string }>;
  text?: string;
};

export default async function VAScorecardsPage() {
  await requireAuth();

  // Latest scorecard per VA (last 12 weeks)
  const since = new Date();
  since.setDate(since.getDate() - 84); // 12 weeks

  const scorecards = await prisma.vaWeeklyScorecard.findMany({
    where: { week_start: { gte: since } },
    orderBy: { week_start: "desc" },
    take: 100,
    select: {
      id: true,
      slack_user_id: true,
      week_start: true,
      generated_at: true,
      scorecard_json: true,
      scorecard_text: true,
      model: true,
      prompt_version: true,
    },
  });

  // Load VA names by slack_user_id
  const slackIds = [...new Set(scorecards.map((s) => s.slack_user_id))];
  const vas = await prisma.va.findMany({
    where: slackIds.length ? { slack_user_id: { in: slackIds } } : undefined,
    select: { id: true, display_name: true, email: true, slack_user_id: true },
  });
  const vaBySlack = Object.fromEntries(vas.filter((v) => v.slack_user_id).map((v) => [v.slack_user_id!, v]));

  // Group by VA
  const grouped: Record<string, { va: (typeof vas)[0] | null; cards: typeof scorecards }> = {};
  for (const card of scorecards) {
    if (!grouped[card.slack_user_id]) {
      grouped[card.slack_user_id] = { va: vaBySlack[card.slack_user_id] ?? null, cards: [] };
    }
    grouped[card.slack_user_id].cards.push(card);
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-6 h-6 text-indigo-500" />
          <h1 className="text-2xl font-bold text-gray-900">Weekly Scorecards</h1>
        </div>
        <span className="text-xs text-gray-400">Last 12 weeks • {scorecards.length} total</span>
      </div>

      {scorecards.length === 0 ? (
        <div className="bg-white rounded-lg border shadow-sm p-12 text-center text-gray-400">
          No weekly scorecards generated yet
        </div>
      ) : (
        Object.entries(grouped).map(([slackId, { va, cards }]) => (
          <div key={slackId} className="bg-white rounded-lg border shadow-sm overflow-hidden">
            {/* VA header */}
            <div className="px-5 py-4 border-b bg-gray-50 flex items-center justify-between">
              <div>
                <span className="font-semibold text-gray-900">
                  {va ? (
                    <Link href={`/vas/${va.id}`} className="hover:underline text-blue-600">
                      {va.display_name ?? va.email}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs">{slackId}</span>
                  )}
                </span>
                <span className="text-xs text-gray-400 ml-2">{cards.length} scorecards</span>
              </div>
            </div>

            {/* Latest scorecard expanded, rest collapsed */}
            {cards.map((card, idx) => {
              const sc = card.scorecard_json as ScorecardJson;
              const weekLabel = new Date(card.week_start).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              });

              if (idx === 0) {
                // Expanded
                return (
                  <div key={card.id} className="p-5 space-y-4">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span className="font-semibold text-gray-700">Week of {weekLabel}</span>
                      {card.model && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{card.model}</span>}
                    </div>

                    {sc.summary && (
                      <p className="text-sm text-gray-700 leading-relaxed">{sc.summary}</p>
                    )}

                    {sc.strengths && sc.strengths.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-1.5">
                          Strengths
                        </p>
                        <ul className="space-y-1">
                          {sc.strengths.map((s, i) => (
                            <li key={i} className="text-sm text-gray-700">
                              <span className="font-medium">✓ {s.title}</span>
                              {s.reasoning && (
                                <span className="text-gray-500 ml-1">— {s.reasoning}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {sc.weaknesses && sc.weaknesses.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1.5">
                          Areas to Improve
                        </p>
                        <ul className="space-y-1">
                          {sc.weaknesses.map((w, i) => (
                            <li key={i} className="text-sm text-gray-700">
                              <span className="font-medium">△ {w.title}</span>
                              {w.reasoning && (
                                <span className="text-gray-500 ml-1">— {w.reasoning}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {sc.risks && sc.risks.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1.5">
                          Risks
                        </p>
                        <ul className="space-y-0.5">
                          {sc.risks.map((r, i) => (
                            <li key={i} className="text-sm text-gray-700">⚠ {r}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {sc.recommendations && sc.recommendations.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1.5">
                          Recommendations
                        </p>
                        <ul className="space-y-1">
                          {sc.recommendations.map((r, i) => (
                            <li key={i} className="text-sm text-gray-700">
                              → {r.title}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {!sc.summary && !sc.strengths && card.scorecard_text && (
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">{card.scorecard_text}</p>
                    )}
                  </div>
                );
              }

              // Collapsed — just show a row
              return (
                <div key={card.id} className="px-5 py-3 border-t flex items-center gap-3 text-sm text-gray-500">
                  <span className="text-xs font-medium text-gray-400">Week of {weekLabel}</span>
                  {sc.summary && (
                    <span className="text-xs line-clamp-1 text-gray-500 flex-1">{sc.summary}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
