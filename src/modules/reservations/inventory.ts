import { prisma } from "@/lib/prisma";

export async function countActiveReservations(classSessionId: string) {
  const now = new Date();
  return prisma.reservation.count({
    where: {
      classSessionId,
      OR: [
        { status: "PAID" },
        {
          status: "PENDING_PAYMENT",
          holdExpiresAt: { gt: now },
        },
      ],
    },
  });
}

export async function remainingSpots(classSessionId: string, capacity: number) {
  const used = await countActiveReservations(classSessionId);
  return Math.max(0, capacity - used);
}
