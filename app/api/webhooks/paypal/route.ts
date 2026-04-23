/**
 * POST /api/webhooks/paypal — PayPal IPN/webhook for bucket provisioning
 * POST /api/webhooks/veem   — Veem payment webhook for bucket provisioning
 *
 * Note: These are separate route handlers but share the bucket-provisioning logic.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Veem uses HMAC-SHA256 with VEEM_WEBHOOK_SECRET
async function verifyVeemSignature(req: Request, body: string): Promise<boolean> {
  const secret = process.env.VEEM_WEBHOOK_SECRET;
  if (!secret) return false;
  const sig = req.headers.get("x-veem-signature");
  if (!sig) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const computed = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return computed === sig;
}

/**
 * Provision hours to the most-recent active bucket for a customer.
 * Creates a new bucket if none exists.
 */
async function provisionHours(customerId: number, hours: number, notes: string) {
  const bucket = await prisma.bucket.findFirst({
    where: { customer_id: customerId, status: "active" },
    orderBy: { purchased_at: "desc" },
  });
  if (bucket) {
    await prisma.bucket.update({
      where: { id: bucket.id },
      data: {
        hours_purchased: { increment: hours },
        hours_balance: { increment: hours },
        notes: notes,
      },
    });
  } else {
    await prisma.bucket.create({
      data: {
        customer_id: customerId,
        hours_purchased: hours,
        hours_balance: hours,
        status: "active",
        notes: notes,
      },
    });
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const provider = url.pathname.split("/").pop(); // "paypal" or "veem"

  const body = await req.text();
  let payload: Record<string, unknown>;

  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Veem: verify signature
  if (provider === "veem") {
    const valid = await verifyVeemSignature(req, body);
    if (!valid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  // PayPal: trust IPN verification (production apps use PayPal IPN listener pattern)
  // For now we verify the event_type from PayPal webhook v2 format
  const eventType = (payload.event_type as string) ?? (payload.event as string) ?? "";
  const isPayPalPayment = eventType === "PAYMENT.CAPTURE.COMPLETED" || eventType === "CHECKOUT.ORDER.APPROVED";
  const isVeemPayment = provider === "veem" && (payload.status === "PAID" || payload.status === "COMPLETED");

  if (!isPayPalPayment && !isVeemPayment) {
    // Not a payment event — acknowledge but skip
    return NextResponse.json({ ok: true, status: "skipped", event_type: eventType });
  }

  // Extract amount and metadata
  let amountUsd = 0;
  let customerId: number | null = null;
  let externalRef = "";

  if (provider === "paypal") {
    const resource = payload.resource as Record<string, unknown> | undefined;
    const amount = resource?.amount as Record<string, unknown> | undefined;
    amountUsd = parseFloat(String(amount?.value ?? "0"));
    const metadata = resource?.custom_id ?? resource?.invoice_id ?? "";
    externalRef = String(metadata);
  } else if (provider === "veem") {
    amountUsd = parseFloat(String((payload.amount as Record<string, unknown>)?.value ?? "0"));
    externalRef = String(payload.reference_id ?? payload.id ?? "");
  }

  // Resolve customer from external reference (format: "customer:{id}" or just the id)
  const customerIdStr = externalRef.replace("customer:", "").trim();
  if (customerIdStr && !isNaN(parseInt(customerIdStr))) {
    customerId = parseInt(customerIdStr);
  }

  // $1 = 1 minute → standard: $X per hour → hours = amountUsd / hourlyRate
  // Default rate: $150/hr (overridable via env)
  const hourlyRate = parseFloat(process.env.HOURLY_RATE ?? "150");
  const hoursToAdd = amountUsd / hourlyRate;

  if (customerId && hoursToAdd > 0) {
    await provisionHours(
      customerId,
      hoursToAdd,
      `Auto-provisioned via ${provider} payment ($${amountUsd}) ref:${externalRef}`
    );
  }

  return NextResponse.json({
    ok: true,
    provisioned: customerId ? { customer_id: customerId, hours: hoursToAdd } : null,
  });
}
