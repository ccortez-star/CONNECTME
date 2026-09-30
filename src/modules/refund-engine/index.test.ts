import { describe, expect, it } from "vitest";
import { fromZonedTime } from "date-fns-tz";
import {
  isRefundEligibleAt,
  quoteRefundPolicy,
  refundableAmountCents,
  shouldOfferExtendedProtection,
} from "./index";

const TZ = "America/New_York";

function zoned(isoLocal: string) {
  return fromZonedTime(isoLocal, TZ);
}

describe("refund policy engine", () => {
  const purchase = zoned("2026-09-23T15:00:00");
  const classStart = zoned("2026-09-25T19:00:00");

  it("standard: refund at 2:59 PM next day is eligible; 3:01 PM is not", () => {
    const quote = quoteRefundPolicy({
      purchaseAt: purchase,
      classStartAt: classStart,
      classPriceCents: 2000,
      protectionPriceCents: 500,
    });
    expect(quote.immediatelyNonRefundable).toBe(false);
    expect(quote.standardDeadlineAt).toEqual(zoned("2026-09-24T15:00:00"));

    const terms = {
      purchaseAt: purchase,
      classStartAt: classStart,
      protectionPurchased: false,
      standardDeadlineAt: quote.standardDeadlineAt,
      extendedDeadlineAt: quote.extendedDeadlineAt,
      classPriceCents: 2000,
      protectionPriceCents: 500,
    };

    expect(isRefundEligibleAt(terms, zoned("2026-09-24T14:59:00"))).toBe(true);
    expect(isRefundEligibleAt(terms, zoned("2026-09-24T15:01:00"))).toBe(false);
    expect(refundableAmountCents(terms, zoned("2026-09-24T14:59:00"))).toBe(2000);
  });

  it("purchase less than 24 hours before class is immediately non-refundable", () => {
    const p = zoned("2026-09-25T14:00:00");
    const s = zoned("2026-09-25T19:00:00");
    const quote = quoteRefundPolicy({
      purchaseAt: p,
      classStartAt: s,
      classPriceCents: 2000,
      protectionPriceCents: 500,
    });
    expect(quote.immediatelyNonRefundable).toBe(true);
    expect(quote.protectionOffered).toBe(false);
    expect(
      isRefundEligibleAt(
        {
          purchaseAt: p,
          classStartAt: s,
          protectionPurchased: false,
          standardDeadlineAt: null,
          extendedDeadlineAt: null,
          classPriceCents: 2000,
          protectionPriceCents: 500,
        },
        p,
      ),
    ).toBe(false);
  });

  it("extended protection provides additional refund time when it actually extends", () => {
    const quote = quoteRefundPolicy({
      purchaseAt: purchase,
      classStartAt: classStart,
      classPriceCents: 2000,
      protectionPriceCents: 500,
    });
    expect(quote.protectionOffered).toBe(true);
    expect(quote.standardDeadlineAt).toEqual(zoned("2026-09-24T15:00:00"));
    expect(quote.extendedDeadlineAt).toEqual(zoned("2026-09-24T19:00:00"));

    const withProtection = {
      purchaseAt: purchase,
      classStartAt: classStart,
      protectionPurchased: true,
      standardDeadlineAt: quote.standardDeadlineAt,
      extendedDeadlineAt: quote.extendedDeadlineAt,
      classPriceCents: 2000,
      protectionPriceCents: 500,
    };
    expect(isRefundEligibleAt(withProtection, zoned("2026-09-24T18:00:00"))).toBe(
      true,
    );
    expect(isRefundEligibleAt(withProtection, zoned("2026-09-24T19:01:00"))).toBe(
      false,
    );
    expect(refundableAmountCents(withProtection, zoned("2026-09-24T18:00:00"))).toBe(
      2000,
    );
  });

  it("does not offer protection when it would not add refund time", () => {
    const p = zoned("2026-09-24T18:00:00");
    const s = zoned("2026-09-25T19:00:00");
    expect(shouldOfferExtendedProtection(p, s)).toBe(false);
    const quote = quoteRefundPolicy({
      purchaseAt: p,
      classStartAt: s,
      classPriceCents: 2000,
      protectionPriceCents: 500,
    });
    expect(quote.immediatelyNonRefundable).toBe(false);
    expect(quote.protectionOffered).toBe(false);
  });

  it("does not allow refunds after class begins", () => {
    const quote = quoteRefundPolicy({
      purchaseAt: purchase,
      classStartAt: classStart,
      classPriceCents: 2000,
      protectionPriceCents: 500,
    });
    const terms = {
      purchaseAt: purchase,
      classStartAt: classStart,
      protectionPurchased: true,
      standardDeadlineAt: quote.standardDeadlineAt,
      extendedDeadlineAt: quote.extendedDeadlineAt,
      classPriceCents: 2000,
      protectionPriceCents: 500,
    };
    expect(isRefundEligibleAt(terms, classStart)).toBe(false);
    expect(isRefundEligibleAt(terms, zoned("2026-09-25T19:00:01"))).toBe(false);
  });

  it("exact 24-hour purchase boundary uses standard window (>= 24 hours)", () => {
    const p = zoned("2026-09-24T19:00:00");
    const s = zoned("2026-09-25T19:00:00");
    const quote = quoteRefundPolicy({
      purchaseAt: p,
      classStartAt: s,
      classPriceCents: 2000,
      protectionPriceCents: 500,
    });
    expect(quote.immediatelyNonRefundable).toBe(false);
    expect(quote.protectionOffered).toBe(false);
    expect(quote.standardDeadlineAt).toEqual(s);
  });
});
