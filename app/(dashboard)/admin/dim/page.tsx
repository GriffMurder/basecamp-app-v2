import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Shield, AlertTriangle, CheckCircle, Info } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

const SEVERITY_META = {
  critical: { label: "Critical", cls: "bg-red-100 text-red-700", Icon: AlertTriangle },
  warning:  { label: "Warning",  cls: "bg-amber-100 text-amber-700", Icon: AlertTriangle },
  info:     { label: "Info",     cls: "bg-blue-100 text-blue-700", Icon: Info },
};

const FINDING_LABELS: Record<string, string> = {
  STUCK_IN_CREATED:              "Stuck in Created",
  STALE_IN_PROGRESS:             "Stale In Progress",
  PM_COMPLETED_BUT_LIFECYCLE_OPEN: "PM Complete / Lifecycle Open",
  ORPHAN_ASSIGNMENT:             "Orphan Assignment",
};

export default async function DimPage() {
  await requireAdmin();

  const [openFindings, resolvedCount, byType, bySeverity] = await Promise.all([
    prisma.taskIntegrityFinding.findMany({
      where: { resolved_at: null },
      orderBy: [{ severity: "asc" }, { detected_at: "desc" }],
      take: 200,
      select: {
        id: true,
        todo_id: true,
        finding_type: true,
        detail: true,
        severity: true,
        detected_at: true,
      },
    }),
    prisma.taskIntegrityFinding.count({ where: { resolved_at: { not: null } } }),
    prisma.taskIntegrityFinding.groupBy({
      by: ["finding_type"],
      where: { resolved_at: null },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),
    prisma.taskIntegrityFinding.groupBy({
      by: ["severity"],
      where: { resolved_at: null },
      _count: { id: true },
    }),
  ]);

  const severityOrder = ["critical", "warning", "info"];
  const grouped = severityOrder.reduce<Record<string, typeof openFindings>>((acc, sev) => {
    acc[sev] = openFindings.filter((f) => f.severity === sev);
    return acc;
  }, {});

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Shield className="w-6 h-6 text-blue-500" />
        <h1 className="text-2xl font-bold text-gray-900">Data Integrity Monitor</h1>
        <span className="ml-2 text-sm text-gray-400">{openFindings.length} open findings</span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-red-600">{grouped.critical?.length ?? 0}</p>
          <p className="text-xs text-gray-500 mt-0.5">Critical</p>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-amber-600">{grouped.warning?.length ?? 0}</p>
          <p className="text-xs text-gray-500 mt-0.5">Warnings</p>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-blue-600">{grouped.info?.length ?? 0}</p>
          <p className="text-xs text-gray-500 mt-0.5">Info</p>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4 text-center">
          <p className="text-2xl font-bold text-emerald-600">{resolvedCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">Resolved All-Time</p>
        </div>
      </div>

      {/* Finding type breakdown */}
      {byType.length > 0 && (
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Open by Type</h2>
          <div className="flex flex-wrap gap-2">
            {byType.map((bt) => (
              <span key={bt.finding_type} className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">
                {FINDING_LABELS[bt.finding_type] ?? bt.finding_type}: <span className="font-bold">{bt._count.id}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Findings grouped by severity */}
      {openFindings.length === 0 ? (
        <div className="bg-white rounded-lg border shadow-sm p-12 text-center">
          <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
          <p className="text-gray-500">No open integrity findings — system looks clean.</p>
        </div>
      ) : (
        severityOrder.map((sev) => {
          const rows = grouped[sev] ?? [];
          if (rows.length === 0) return null;
          const meta = SEVERITY_META[sev as keyof typeof SEVERITY_META] ?? SEVERITY_META.info;
          const SevIcon = meta.Icon;
          return (
            <div key={sev} className="bg-white rounded-lg border shadow-sm overflow-hidden">
              <div className={`px-4 py-3 border-b ${meta.cls} flex items-center gap-2`}>
                <SevIcon className="w-4 h-4" />
                <span className="text-sm font-semibold">{meta.label} ({rows.length})</span>
              </div>
              <div className="divide-y divide-gray-100">
                {rows.map((finding) => (
                  <div key={finding.id} className="px-4 py-3 flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-800">
                          {FINDING_LABELS[finding.finding_type] ?? finding.finding_type}
                        </span>
                        <span className="font-mono text-xs text-gray-400">Todo #{finding.todo_id}</span>
                      </div>
                      {finding.detail && (
                        <p className="text-xs text-gray-500">{finding.detail}</p>
                      )}
                      <p className="text-xs text-gray-400">
                        Detected {new Date(finding.detected_at).toLocaleString()}
                      </p>
                    </div>
                    <Link
                      href={`/todos?q=${finding.todo_id}`}
                      className="text-xs text-blue-500 hover:underline shrink-0"
                    >
                      View Todo →
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
