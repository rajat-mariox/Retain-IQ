/**
 * Authoritative subscription pricing. ONE implementation, shared by billing-service
 * (invoices, MRR, provisioning), identity-service (org billing page, admin rollups)
 * and — mirrored — the frontends' seat-stepper preview. Never re-inline the maths.
 *
 * Model (all amounts in USD cents):
 *
 *   total = basePrice + max(0, seatQuantity - includedSeats) * additionalSeatPrice
 *
 * The legacy flat per-seat plan (basePrice=0, includedSeats=0,
 * additionalSeatPrice=pricePerSeat) collapses to `seatQuantity * pricePerSeat`, so
 * existing plans price identically until a super-admin sets a real base/included model.
 */

/** The pricing inputs a plan (or a subscription's locked rate) provides. */
export interface PlanPricing {
  basePrice: number; // cents
  includedSeats: number;
  additionalSeatPrice: number; // cents per seat beyond includedSeats
}

/** A full, itemised price breakdown — what the UI and invoices display. */
export interface PriceBreakdown {
  basePrice: number; // cents
  includedSeats: number;
  seatQuantity: number;
  additionalSeats: number; // seats beyond includedSeats (never negative)
  additionalSeatPrice: number; // cents each
  additionalSeatTotal: number; // cents
  totalPrice: number; // cents
}

/**
 * Compute the full price breakdown for a plan at a given seat quantity.
 * `seatQuantity` is clamped to a floor of 0 so a bad input can't produce a credit.
 */
export function computePrice(pricing: PlanPricing, seatQuantity: number): PriceBreakdown {
  const seats = Math.max(0, Math.floor(seatQuantity));
  const included = Math.max(0, Math.floor(pricing.includedSeats));
  const additionalSeats = Math.max(0, seats - included);
  const additionalSeatTotal = additionalSeats * pricing.additionalSeatPrice;
  const totalPrice = pricing.basePrice + additionalSeatTotal;
  return {
    basePrice: pricing.basePrice,
    includedSeats: included,
    seatQuantity: seats,
    additionalSeats,
    additionalSeatPrice: pricing.additionalSeatPrice,
    additionalSeatTotal,
    totalPrice,
  };
}

/** Just the total (cents) — the common case for invoices/MRR. */
export function computeTotalPrice(pricing: PlanPricing, seatQuantity: number): number {
  return computePrice(pricing, seatQuantity).totalPrice;
}

/**
 * Resolve the pricing a subscription should be charged at: its own rate-lock
 * snapshot if present, else the live plan (pre-migration subscriptions have no
 * lock and fall back to the plan's current terms).
 */
export function effectivePricing(
  locked: Partial<PlanPricing> | null | undefined,
  livePlan: PlanPricing,
): PlanPricing {
  if (locked && locked.additionalSeatPrice != null && locked.basePrice != null && locked.includedSeats != null) {
    return { basePrice: locked.basePrice, includedSeats: locked.includedSeats, additionalSeatPrice: locked.additionalSeatPrice };
  }
  return livePlan;
}

/**
 * Derive a plan's pricing model from whatever columns it has. If the new
 * base/included/additional columns are unset (all zero) but a legacy pricePerSeat
 * exists, treat it as a flat per-seat plan so nothing regresses.
 */
export function planPricingOf(plan: {
  basePrice?: number | null;
  includedSeats?: number | null;
  additionalSeatPrice?: number | null;
  pricePerSeat?: number | null;
}): PlanPricing {
  const base = plan.basePrice ?? 0;
  const included = plan.includedSeats ?? 0;
  const additional = plan.additionalSeatPrice ?? 0;
  // A plan that hasn't been given a base/included model yet: fall back to flat.
  if (base === 0 && included === 0 && additional === 0 && plan.pricePerSeat) {
    return { basePrice: 0, includedSeats: 0, additionalSeatPrice: plan.pricePerSeat };
  }
  return { basePrice: base, includedSeats: included, additionalSeatPrice: additional };
}
