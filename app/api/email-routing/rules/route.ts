/**
 * POST   /api/email-routing/rules      — create a new Cloudflare routing rule
 * DELETE /api/email-routing/rules/[tag] — delete a routing rule
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createRoutingRule } from "@/lib/cloudflare-email";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateRuleSchema = z.object({
  name: z.string().min(1).max(200),
  receiving_address: z.string().email(),
  destination_address: z.string().email(),
  enabled: z.boolean().default(true),
});

export async function POST(req: Request) {
  await requireAuth();
  const body = await req.json();
  const parsed = CreateRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const { name, receiving_address, destination_address, enabled } = parsed.data;

  try {
    const rule = await createRoutingRule({
      name,
      enabled,
      matchers: [{ type: "literal", field: "to", value: receiving_address }],
      actions: [{ type: "forward", value: [destination_address] }],
    });
    return NextResponse.json({ ok: true, rule }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
