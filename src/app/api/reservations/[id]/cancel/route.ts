import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isRefundEligibleAt, refundableAmountCents } from "@/modules/refund-engine";
import { getStripe } from "@/modules/payments/stripe";
import { writeAudit } from "@/modules/audit/log";
import { getStaffUser } from "@/modules/auth/session";
import { assertSessionAccess, AuthzError } from "@/modules/authz";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const reservation = await prisma.reservation.findUnique({
    where: { id },
    include: { payment: true },
  });
  if (!reservation || reservation.status !== "PAID") {
    return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
  }

  const json = await request.json().catch(() => ({}));
  const staffInitiated = Boolean((json as { staff?: boolean }).staff);
  const actor = await getStaffUser();

  if (staffInitiated) {
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
      if (actor.role !== "OWNER") {
        await assertSessionAccess(
          actor,
          reservation.classSessionId,
          "process_refunds",
        );
      }
    } catch (err) {
      if (err instanceof AuthzError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      throw err;
    }
  } else if (!isRefundEligibleAt(reservation, new Date())) {
    return NextResponse.json(
      { error: "This reservation is not refundable" },
      { status: 400 },
    );
  }

  const amount = staffInitiated
    ? reservation.classPriceCents
    : refundableAmountCents(reservation, new Date());
  if (amount <= 0) {
    return NextResponse.json(
      { error: "This reservation is not refundable" },
      { status: 400 },
    );
  }

  const stripe = getStripe();
  if (!stripe || !reservation.paymentTransactionId) {
    return NextResponse.json({ error: "Payment provider unavailable" }, { status: 503 });
  }

  const refund = await stripe.refunds.create({
    payment_intent: reservation.paymentTransactionId,
    amount,
  });

  await prisma.$transaction([
    prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        status: "REFUNDED",
        refundStatus: "SUCCEEDED",
        refundedAt: new Date(),
        paymentStatus: "REFUNDED",
      },
    }),
    prisma.refund.create({
      data: {
        reservationId: reservation.id,
        initiatedByUserId: actor?.id ?? null,
        amountCents: amount,
        providerRefundId: refund.id,
        status: "SUCCEEDED",
      },
    }),
  ]);

  await writeAudit({
    organizationId: reservation.organizationId,
    userId: actor?.id,
    action: "refund_processed",
    resourceType: "reservation",
    resourceId: reservation.id,
    previous: { refundStatus: reservation.refundStatus },
    next: { refundStatus: "SUCCEEDED", amountCents: amount },
  });

  return NextResponse.json({ ok: true, amountCents: amount });
}
