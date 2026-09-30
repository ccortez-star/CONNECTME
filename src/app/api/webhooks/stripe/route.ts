import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/modules/payments/stripe";
import { markReservationPaid } from "@/modules/payments/reconcile";

export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const raw = await request.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const seen = await prisma.processedWebhookEvent.findUnique({
    where: {
      provider_eventId: { provider: "stripe", eventId: event.id },
    },
  });
  if (seen) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object;
    const method =
      typeof intent.payment_method === "string" ? intent.payment_method : undefined;
    await markReservationPaid(intent.id, intent.payment_method_types?.[0] ?? method);
  }

  if (
    event.type === "payment_intent.payment_failed" ||
    event.type === "payment_intent.canceled"
  ) {
    const intent = event.data.object;
    await prisma.payment.updateMany({
      where: { providerPaymentId: intent.id },
      data: { status: event.type === "payment_intent.canceled" ? "CANCELED" : "FAILED" },
    });
    await prisma.reservation.updateMany({
      where: { paymentTransactionId: intent.id, status: "PENDING_PAYMENT" },
      data: {
        paymentStatus: event.type === "payment_intent.canceled" ? "CANCELED" : "FAILED",
        status: "EXPIRED",
      },
    });
  }

  await prisma.processedWebhookEvent.create({
    data: { provider: "stripe", eventId: event.id },
  });

  return NextResponse.json({ received: true });
}
