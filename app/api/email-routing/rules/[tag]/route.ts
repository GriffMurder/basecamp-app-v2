/**
 * DELETE /api/email-routing/rules/[tag] — remove a routing rule from Cloudflare
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { deleteRoutingRule } from "@/lib/cloudflare-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ tag: string }> }
) {
  await requireAdmin();
  const { tag } = await params;

  try {
    await deleteRoutingRule(tag);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
