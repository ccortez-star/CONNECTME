import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentPolicy, getSettings, resolveSessionPrice } from "@/lib/settings";
import { quoteRefundPolicy } from "@/modules/refund-engine";
import { remainingSpots } from "@/modules/reservations/inventory";

const bodySchema = z.object({
  classSessionId: z.string().min(1),
  protectionRequested: z.boolean().optional(),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const session = await prisma.classSession.findUnique({
    where: { id: parsed.data.classSessionId },
    include: { location: true, category: true, instructors: { include: { user: true } } },
  });
  if (!session || session.status !== "PUBLISHED") {
    return NextResponse.json({ error: "Class not available" }, { status: 404 });
  }

  const settings = await getSettings();
  const policy = await getCurrentPolicy();
  const prices = resolveSessionPrice(session, settings);
  const purchaseAt = new Date();
  const quote = quoteRefundPolicy({
    purchaseAt,
    classStartAt: session.startsAt,
    classPriceCents: prices.classPriceCents,
    protectionPriceCents: prices.protectionPriceCents,
  });

  const protectionPurchased = Boolean(
    parsed.data.protectionRequested && quote.protectionOffered,
  );
  const totalCents =
    prices.classPriceCents + (protectionPurchased ? prices.protectionPriceCents : 0);
  const spots = await remainingSpots(session.id, session.capacity);

  return NextResponse.json({
    classSessionId: session.id,
    name: session.name,
    description: session.description,
    category: session.category.name,
    location: session.location.name,
    timezone: session.timezone,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    instructors: session.instructors.map((i) => i.user.name),
    spotsRemaining: spots,
    currency: settings.currency,
    classPriceCents: prices.classPriceCents,
    protectionPriceCents: prices.protectionPriceCents,
    protectionOffered: quote.protectionOffered,
    immediatelyNonRefundable: quote.immediatelyNonRefundable,
    protectionPurchased,
    totalCents,
    standardDeadlineAt: quote.standardDeadlineAt?.toISOString() ?? null,
    extendedDeadlineAt: quote.extendedDeadlineAt?.toISOString() ?? null,
    applicableDeadlineAt: protectionPurchased
      ? quote.extendedDeadlineAt?.toISOString() ?? null
      : quote.standardDeadlineAt?.toISOString() ?? null,
    policyVersion: policy.version,
    policyBody: policy.body,
    quotedAt: purchaseAt.toISOString(),
  });
}
