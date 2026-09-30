/**
 * Dedicated refund-policy engine.
 * Business rules are implemented exactly as specified — no additional windows.
 *
 * Boundary: refunds are allowed only when now < deadline ("before that deadline").
 * Purchases 24 hours or more before class start receive a standard window.
 * Purchases less than 24 hours before class start are immediately non-refundable.
 */

export const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export type RefundQuote = {
  purchaseAt: Date;
  classStartAt: Date;
  classPriceCents: number;
  protectionPriceCents: number;
  immediatelyNonRefundable: boolean;
  protectionOffered: boolean;
  standardDeadlineAt: Date | null;
  extendedDeadlineAt: Date | null;
};

export type StoredRefundTerms = {
  purchaseAt: Date;
  classStartAt: Date;
  protectionPurchased: boolean;
  standardDeadlineAt: Date | null;
  extendedDeadlineAt: Date | null;
  classPriceCents: number;
  protectionPriceCents: number;
};

export function hoursBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / (1000 * 60 * 60);
}

export function isLessThanTwentyFourHoursBeforeClass(
  purchaseAt: Date,
  classStartAt: Date,
): boolean {
  return classStartAt.getTime() - purchaseAt.getTime() < TWENTY_FOUR_HOURS_MS;
}

export function computeStandardDeadline(purchaseAt: Date): Date {
  return new Date(purchaseAt.getTime() + TWENTY_FOUR_HOURS_MS);
}

export function computeExtendedDeadline(classStartAt: Date): Date {
  return new Date(classStartAt.getTime() - TWENTY_FOUR_HOURS_MS);
}

export function shouldOfferExtendedProtection(
  purchaseAt: Date,
  classStartAt: Date,
): boolean {
  if (isLessThanTwentyFourHoursBeforeClass(purchaseAt, classStartAt)) {
    return false;
  }
  const standard = computeStandardDeadline(purchaseAt);
  const extended = computeExtendedDeadline(classStartAt);
  return extended.getTime() > standard.getTime();
}

export function quoteRefundPolicy(input: {
  purchaseAt: Date;
  classStartAt: Date;
  classPriceCents: number;
  protectionPriceCents: number;
}): RefundQuote {
  const { purchaseAt, classStartAt, classPriceCents, protectionPriceCents } =
    input;
  const immediatelyNonRefundable = isLessThanTwentyFourHoursBeforeClass(
    purchaseAt,
    classStartAt,
  );

  if (immediatelyNonRefundable) {
    return {
      purchaseAt,
      classStartAt,
      classPriceCents,
      protectionPriceCents,
      immediatelyNonRefundable: true,
      protectionOffered: false,
      standardDeadlineAt: null,
      extendedDeadlineAt: null,
    };
  }

  const standardDeadlineAt = computeStandardDeadline(purchaseAt);
  const extendedDeadlineAt = computeExtendedDeadline(classStartAt);
  const protectionOffered =
    extendedDeadlineAt.getTime() > standardDeadlineAt.getTime();

  return {
    purchaseAt,
    classStartAt,
    classPriceCents,
    protectionPriceCents,
    immediatelyNonRefundable: false,
    protectionOffered,
    standardDeadlineAt,
    extendedDeadlineAt: protectionOffered ? extendedDeadlineAt : null,
  };
}

export function applicableDeadline(terms: StoredRefundTerms): Date | null {
  if (isLessThanTwentyFourHoursBeforeClass(terms.purchaseAt, terms.classStartAt)) {
    return null;
  }
  if (terms.protectionPurchased && terms.extendedDeadlineAt) {
    return terms.extendedDeadlineAt;
  }
  return terms.standardDeadlineAt;
}

export function isRefundEligibleAt(terms: StoredRefundTerms, now: Date): boolean {
  if (now.getTime() >= terms.classStartAt.getTime()) {
    return false;
  }
  const deadline = applicableDeadline(terms);
  if (!deadline) {
    return false;
  }
  return now.getTime() < deadline.getTime();
}

/** Class price only. Protection fee is never refunded. */
export function refundableAmountCents(terms: StoredRefundTerms, now: Date): number {
  if (!isRefundEligibleAt(terms, now)) {
    return 0;
  }
  return terms.classPriceCents;
}
