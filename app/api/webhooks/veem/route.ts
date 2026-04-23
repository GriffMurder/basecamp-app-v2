/**
 * POST /api/webhooks/veem — Veem payment webhook
 * Re-uses the same provisioning logic as PayPal webhook.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function POST(req: Request) {
  const body = await req.text();
  const valid = await verifyVeemSignature(req, body);
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const status = String(payload.status ?? "");
  if (status !== "PAID" && status !== "COMPLETED") {
    return NextResponse.json({ ok: true, status: "skipped", payment_status: status });
  }

  const amountUsd = parseFloat(String((payload.amount as Record<string, unknown>)?.value ?? "0"));
  const externalRef = String(payload.reference_id ?? payload.id ?? "");

  const customerIdStr = externalRef.replace("customer:", "").trim();
  const customerId = customerIdStr && !isNaN(parseInt(customerIdStr)) ? parseInt(customerIdStr) : null;

  const hourlyRate = parseFloat(process.env.HOURLY_RATE ?? "150");
  const hoursToAdd = amountUsd / hourlyRate;

  if (customerId && hoursToAdd > 0) {
    const bucket = await prisma.bucket.findFirst({
      where: { customer_id: customerId, status: "active" },
      orderBy: { purchased_at: "desc" },
    });
    if (bucket) {
      await prisma.bucket.update({
        where: { id: bucket.id },
        data: {
          hours_purchased: { increment: hoursToAdd },
          hours_balance: { increment: hoursToAdd },
          notes: `Auto-provisioned via Veem ($${amountUsd}) ref:${externalRef}`,
        },
      });
    } else {
      await prisma.bucket.create({
        data: {
          customer_id: customerId,
          hours_purchased: hoursToAdd,
          hours_balance: hoursToAdd,
          status: "active",
          notes: `Auto-provisioned via Veem ($${amountUsd}) ref:${externalRef}`,
        },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    provisioned: customerId ? { customer_id: customerId, hours: hoursToAdd } : null,
  });
}
