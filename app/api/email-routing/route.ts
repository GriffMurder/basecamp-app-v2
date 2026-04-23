/**
 * GET    /api/email-routing/rules              — list Cloudflare routing rules
 * POST   /api/email-routing/destinations       — register a destination address (CF sends verification email)
 * DELETE /api/email-routing/destinations/[tag] — remove a destination address
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  listDestinationAddresses,
  createDestinationAddress,
  listRoutingRules,
} from "@/lib/cloudflare-email";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await requireAuth();

  const cfConfigured =
    !!process.env.CLOUDFLARE_API_TOKEN &&
    !!process.env.CLOUDFLARE_ACCOUNT_ID &&
    !!process.env.CLOUDFLARE_ZONE_ID;

  if (!cfConfigured) {
    return NextResponse.json(
      { error: "Cloudflare credentials not configured" },
      { status: 503 }
    );
  }

  const [destinations, rules] = await Promise.all([
    listDestinationAddresses(),
    listRoutingRules(),
  ]);

  return NextResponse.json({ ok: true, destinations, rules });
}

const AddDestSchema = z.object({
  email: z.string().email(),
});

export async function POST(req: Request) {
  await requireAuth();
  const body = await req.json();
  const parsed = AddDestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  try {
    const destination = await createDestinationAddress(parsed.data.email);
    return NextResponse.json({ ok: true, destination }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
