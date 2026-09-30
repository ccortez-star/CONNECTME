import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  getCurrentPolicy,
  getOrganization,
  getSettings,
  resolveSessionPrice,
} from "@/lib/settings";
import { quoteRefundPolicy } from "@/modules/refund-engine";
import { remainingSpots } from "@/modules/reservations/inventory";
import { getStripe } from "@/modules/payments/stripe";

const bodySchema = z.object({
  classSessionId: z.string().min(1),
  customerName: z.string().trim().min(1),
  customerEmail: z.string().trim().email(),
  customerPhone: z.string().trim().optional(),
  protectionRequested: z.boolean(),
  policyAccepted: z.literal(true),
  idempotencyKey: z.string().min(16),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid checkout request" }, { status: 400 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Payment is not configured. Set STRIPE_SECRET_KEY." },
      { status: 503 },
    );
  }

  const org = await getOrganization();
  const settings = await getSettings();
  const policy = await getCurrentPolicy();

  const session = await prisma.classSession.findUnique({
    where: { id: parsed.data.classSessionId },
    include: { instructors: true },
  });
  if (!session || session.status !== "PUBLISHED") {
    return NextResponse.json({ error: "Class not available" }, { status: 404 });
  }
  if (session.startsAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "Class has already started" }, { status: 400 });
  }

  const spots = await remainingSpots(session.id, session.capacity);
  if (spots < 1) {
    return NextResponse.json({ error: "This class is full" }, { status: 409 });
  }

  const purchaseAt = new Date();
  const prices = resolveSessionPrice(session, settings);
  const quote = quoteRefundPolicy({
    purchaseAt,
    classStartAt: session.startsAt,
    classPriceCents: prices.classPriceCents,
    protectionPriceCents: prices.protectionPriceCents,
  });

  if (parsed.data.protectionRequested && !quote.protectionOffered) {
    return NextResponse.json(
      { error: "Extended Refund Protection is not available for this purchase" },
      { status: 400 },
    );
  }

  const protectionPurchased =
    parsed.data.protectionRequested && quote.protectionOffered;
  const totalCents =
    prices.classPriceCents + (protectionPurchased ? prices.protectionPriceCents : 0);

  const customer = await prisma.customer.upsert({
    where: {
      organizationId_email: {
        organizationId: org.id,
        email: parsed.data.customerEmail.toLowerCase(),
      },
    },
    update: {
      name: parsed.data.customerName,
      phone: parsed.data.customerPhone || undefined,
    },
    create: {
      organizationId: org.id,
      name: parsed.data.customerName,
      email: parsed.data.customerEmail.toLowerCase(),
      phone: parsed.data.customerPhone || null,
    },
  });

  const holdExpiresAt = new Date(purchaseAt.getTime() + settings.holdMinutes * 60 * 1000);
  const instructorId = session.instructors[0]?.userId ?? null;

  const reservation = await prisma.$transaction(async (tx) => {
    const used = await tx.reservation.count({
      where: {
        classSessionId: session.id,
        OR: [
          { status: "PAID" },
          { status: "PENDING_PAYMENT", holdExpiresAt: { gt: purchaseAt } },
        ],
      },
    });
    if (used >= session.capacity) {
      throw new Error("FULL");
    }

    const existingPaid = await tx.reservation.findFirst({
      where: {
        customerId: customer.id,
        classSessionId: session.id,
        status: { in: ["PAID", "PENDING_PAYMENT"] },
      },
    });
    if (existingPaid?.status === "PAID") {
      throw new Error("DUPLICATE");
    }
    if (
      existingPaid?.status === "PENDING_PAYMENT" &&
      existingPaid.holdExpiresAt &&
      existingPaid.holdExpiresAt.getTime() > purchaseAt.getTime()
    ) {
      return existingPaid;
    }

    return tx.reservation.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        classSessionId: session.id,
        instructorId,
        purchaseAt,
        classStartAt: session.startsAt,
        classTimezone: session.timezone,
        classPriceCents: prices.classPriceCents,
        protectionPriceCents: protectionPurchased ? prices.protectionPriceCents : 0,
        protectionPurchased,
        standardRefundDeadlineAt: quote.standardDeadlineAt,
        extendedRefundDeadlineAt: protectionPurchased
          ? quote.extendedDeadlineAt
          : null,
        paymentProvider: "stripe",
        paymentStatus: "PENDING",
        refundStatus: "NONE",
        policyVersion: policy.version,
        policyAcceptedAt: purchaseAt,
        status: "PENDING_PAYMENT",
        holdExpiresAt,
      },
    });
  }).catch((err: Error) => err);

  if (reservation instanceof Error) {
    if (reservation.message === "FULL") {
      return NextResponse.json({ error: "This class is full" }, { status: 409 });
    }
    if (reservation.message === "DUPLICATE") {
      return NextResponse.json(
        { error: "You already have a reservation for this class" },
        { status: 409 },
      );
    }
    throw reservation;
  }

  await prisma.policyAcceptance.upsert({
    where: { reservationId: reservation.id },
    update: {
      customerId: customer.id,
      policyVersionId: policy.id,
      policyVersionLabel: policy.version,
      policyBody: policy.body,
      acceptedAt: purchaseAt,
      purchaseAt,
      applicableDeadlineAt: protectionPurchased
        ? quote.extendedDeadlineAt
        : quote.standardDeadlineAt,
    },
    create: {
      reservationId: reservation.id,
      customerId: customer.id,
      policyVersionId: policy.id,
      policyVersionLabel: policy.version,
      policyBody: policy.body,
      acceptedAt: purchaseAt,
      purchaseAt,
      applicableDeadlineAt: protectionPurchased
        ? quote.extendedDeadlineAt
        : quote.standardDeadlineAt,
    },
  });

  const intent = await stripe.paymentIntents.create(
    {
      amount: totalCents,
      currency: settings.currency.toLowerCase(),
      metadata: {
        reservationId: reservation.id,
        classSessionId: session.id,
      },
      automatic_payment_methods: { enabled: true },
    },
    { idempotencyKey: parsed.data.idempotencyKey },
  );

  await prisma.reservation.update({
    where: { id: reservation.id },
    data: { paymentTransactionId: intent.id },
  });

  await prisma.payment.upsert({
    where: { reservationId: reservation.id },
    update: {
      providerPaymentId: intent.id,
      amountCents: totalCents,
      currency: settings.currency,
      status: intent.status,
    },
    create: {
      reservationId: reservation.id,
      provider: "stripe",
      providerPaymentId: intent.id,
      status: intent.status,
      amountCents: totalCents,
      currency: settings.currency,
    },
  });

  return NextResponse.json({
    reservationId: reservation.id,
    clientSecret: intent.client_secret,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
  });
}
