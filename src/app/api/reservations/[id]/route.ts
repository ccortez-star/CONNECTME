import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const reservation = await prisma.reservation.findUnique({
    where: { id },
    include: {
      customer: true,
      payment: true,
      policyAcceptance: true,
      classSession: {
        include: { location: true, instructors: { include: { user: true } } },
      },
    },
  });
  if (!reservation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(reservation);
}
