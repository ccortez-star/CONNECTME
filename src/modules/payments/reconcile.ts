import { prisma } from "@/lib/prisma";
import { sendConfirmationEmail } from "@/lib/mail";
import { formatMoney } from "@/lib/money";
import { formatInClassZone } from "@/lib/time";
import { writeAudit } from "@/modules/audit/log";
import { remainingSpots } from "@/modules/reservations/inventory";

export async function markReservationPaid(providerPaymentId: string, methodType?: string) {
  const payment = await prisma.payment.findUnique({
    where: { providerPaymentId },
    include: {
      reservation: {
        include: {
          customer: true,
          classSession: {
            include: { location: true, instructors: { include: { user: true } } },
          },
          policyAcceptance: true,
        },
      },
    },
  });
  if (!payment) return;

  const reservation = payment.reservation;
  if (reservation.status === "PAID") return;

  const now = new Date();
  const holdValid =
    reservation.holdExpiresAt && reservation.holdExpiresAt.getTime() >= now.getTime();

  if (reservation.status === "EXPIRED" || !holdValid) {
    const spots = await remainingSpots(
      reservation.classSessionId,
      reservation.classSession.capacity,
    );
    if (spots < 1 && reservation.status !== "PENDING_PAYMENT") {
      return;
    }
    if (spots < 1) {
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { status: "EXPIRED", paymentStatus: "SUCCEEDED" },
      });
      return;
    }
  }

  await prisma.$transaction([
    prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        status: "PAID",
        paymentStatus: "SUCCEEDED",
        holdExpiresAt: null,
      },
    }),
    prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "SUCCEEDED",
        methodType: methodType ?? payment.methodType,
      },
    }),
  ]);

  await writeAudit({
    organizationId: reservation.organizationId,
    action: "payment_status_changed",
    resourceType: "reservation",
    resourceId: reservation.id,
    previous: { status: reservation.status, paymentStatus: reservation.paymentStatus },
    next: { status: "PAID", paymentStatus: "SUCCEEDED" },
  });

  const cls = reservation.classSession;
  const instructor = cls.instructors[0]?.user.name ?? "TBD";
  const total =
    reservation.classPriceCents +
    (reservation.protectionPurchased ? reservation.protectionPriceCents : 0);
  const deadline =
    reservation.protectionPurchased
      ? reservation.extendedRefundDeadlineAt
      : reservation.standardRefundDeadlineAt;

  await sendConfirmationEmail({
    to: reservation.customer.email,
    subject: `Reservation confirmed: ${cls.name}`,
    text: [
      `Customer: ${reservation.customer.name}`,
      `Class: ${cls.name}`,
      `Instructor: ${instructor}`,
      `Date: ${formatInClassZone(cls.startsAt, cls.timezone, "EEEE, MMMM d, yyyy")}`,
      `Time: ${formatInClassZone(cls.startsAt, cls.timezone, "h:mm a")} – ${formatInClassZone(cls.endsAt, cls.timezone, "h:mm a")}`,
      `Location: ${cls.location.name}`,
      `Amount paid: ${formatMoney(total, payment.currency)}`,
      `Payment method: ${methodType ?? "card"}`,
      `Extended Refund Protection: ${reservation.protectionPurchased ? "Yes" : "No"}`,
      `Refund deadline: ${
        deadline
          ? formatInClassZone(deadline, cls.timezone)
          : "This purchase is non-refundable"
      }`,
      `Policy acknowledged: ${reservation.policyAcceptance ? "Yes" : "No"} (${reservation.policyVersion})`,
    ].join("\n"),
  });
}
