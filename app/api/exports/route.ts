/**
 * GET /api/exports?type=... — CSV export endpoint
 * Types: customers | time_entries | vas | interventions
 * Requires admin role.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v).replace(/"/g, '""');
    return `"${s}"`;
  };
  const lines = [
    headers.map(escape).join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ];
  return lines.join("\r\n");
}

export async function GET(req: Request) {
  await requireAdmin();
  const url = new URL(req.url);
  const type = url.searchParams.get("type");

  const validTypes = ["customers", "time_entries", "vas", "interventions"];
  if (!type || !validTypes.includes(type)) {
    return NextResponse.json(
      { error: `type param required. Valid values: ${validTypes.join(", ")}` },
      { status: 400 }
    );
  }

  let csv = "";
  let filename = "";

  if (type === "customers") {
    const rows = await prisma.customer.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, active: true, effective_tier: true,
        client_health_score: true, bucket_balance: true,
        basecamp_project_id: true, slack_channel_id: true,
        created_at: true,
      },
    });
    csv = toCsv(rows.map((r) => ({
      ...r,
      created_at: r.created_at?.toISOString() ?? "",
    })));
    filename = "customers.csv";
  } else if (type === "time_entries") {
    const rows = await prisma.timeEntry.findMany({
      orderBy: { created_at: "desc" },
      take: 5000,
      select: {
        id: true, customer_id: true, va_id: true, bucket_id: true,
        basecamp_todo_id: true, duration_minutes: true, description: true,
        status: true, approved_at: true, payroll_locked: true,
        start_time: true, end_time: true, created_at: true,
      },
    });
    csv = toCsv(rows.map((r) => ({
      ...r,
      duration_minutes: String(r.duration_minutes),
      approved_at: r.approved_at?.toISOString() ?? "",
      start_time: r.start_time?.toISOString() ?? "",
      end_time: r.end_time?.toISOString() ?? "",
      created_at: r.created_at?.toISOString() ?? "",
    })));
    filename = "time_entries.csv";
  } else if (type === "vas") {
    const rows = await prisma.va.findMany({
      orderBy: { display_name: "asc" },
      select: {
        id: true, display_name: true, email: true, active: true,
        reliability_score: true, capacity_index: true, created_at: true,
      },
    });
    csv = toCsv(rows.map((r) => ({
      ...r,
      reliability_score: String(r.reliability_score ?? ""),
      capacity_index: String(r.capacity_index ?? ""),
      created_at: r.created_at?.toISOString() ?? "",
    })));
    filename = "vas.csv";
  } else if (type === "interventions") {
    const rows = await prisma.intervention.findMany({
      orderBy: { created_at: "desc" },
      take: 5000,
      select: {
        id: true, level: true, reason: true, target_person_id: true,
        customer_id: true, status: true, created_at: true,
        sent_at: true, resolved_at: true, resolution_kind: true,
        root_cause_category: true,
      },
    });
    csv = toCsv(rows.map((r) => ({
      ...r,
      id: String(r.id),
      created_at: r.created_at?.toISOString() ?? "",
      sent_at: r.sent_at?.toISOString() ?? "",
      resolved_at: r.resolved_at?.toISOString() ?? "",
    })));
    filename = "interventions.csv";
  }

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
