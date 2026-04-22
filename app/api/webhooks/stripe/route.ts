/**
 * POST /api/webhooks/stripe
 * Stripe webhook — verifies signature, provisions hour buckets on checkout.
 * Mirrors app/routes/stripe_webhook.py
 */
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { postToOps } from "@/lib/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Stripe webhook secret not configured" }, { status: 500 });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const stripe = new Stripe(stripeKey);
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  // Idempotency check
  const already = await prisma.stripeEvent.findUnique({ where: { stripe_event_id: event.id } });
  if (already) return NextResponse.json({ ok: true, status: "already_processed" });

  // Record the event
  await prisma.stripeEvent.create({
    data: {
      stripe_event_id: event.id,
      event_type: event.type,
      payload_summary: { id: event.id, type: event.type, livemode: event.livemode },
    },
  });

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const customerEmail = session.customer_details?.email ?? session.customer_email;
    const amountTotal = session.amount_total ?? 0;
    const hoursRaw = session.metadata?.hours;
    const hours = hoursRaw ? parseFloat(hoursRaw) : amountTotal / 100 / 10;

    if (customerEmail) {
      const customer = await prisma.customer.findFirst({
        where: {
          OR: [
            { external_id: String(session.customer ?? "") },
            { name: { contains: customerEmail, mode: "insensitive" } },
          ],
        },
      });

      if (customer) {
        await prisma.bucket.create({
          data: {
            customer_id: customer.id,
            hours_purchased: hours,
            stripe_payment_id: String(session.id),
            status: "active",
          },
        });

        await prisma.customer.update({
          where: { id: customer.id },
          data: { bucket_last_added_at: new Date() },
        });

        await postToOps(
          `*Stripe payment*: ${customerEmail} purchased ${hours}h ($${(amountTotal / 100).toFixed(2)}) for ${customer.name}`
        ).catch(() => null);
      }
    }
  }

  return NextResponse.json({ ok: true });
}