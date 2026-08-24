/**
 * Seat-based pricing — a mirror of the backend's authoritative calculator
 * (@retainiq/contracts computePrice), used ONLY for the live seat-stepper preview.
 * The backend re-computes and locks the real charge; this just shows the person
 * the number before they confirm. Amounts are USD cents.
 *
 *   total = basePrice + max(0, seats - includedSeats) * additionalSeatPrice
 */
export interface PlanPricingInput {
  basePrice: number;
  includedSeats: number;
  additionalSeatPrice: number;
  // Legacy flat fallback: if the base/included/additional model is unset (all 0)
  // but a per-seat price exists, price as flat per-seat.
  pricePerSeat?: number;
}

export interface PriceBreakdown {
  basePrice: number;
  includedSeats: number;
  seatQuantity: number;
  additionalSeats: number;
  additionalSeatPrice: number;
  additionalSeatTotal: number;
  totalPrice: number;
}

function pricingModel(p: PlanPricingInput): { basePrice: number; includedSeats: number; additionalSeatPrice: number } {
  if (p.basePrice === 0 && p.includedSeats === 0 && p.additionalSeatPrice === 0 && p.pricePerSeat) {
    return { basePrice: 0, includedSeats: 0, additionalSeatPrice: p.pricePerSeat };
  }
  return { basePrice: p.basePrice, includedSeats: p.includedSeats, additionalSeatPrice: p.additionalSeatPrice };
}

export function computePrice(input: PlanPricingInput, seatQuantity: number): PriceBreakdown {
  const m = pricingModel(input);
  const seats = Math.max(0, Math.floor(seatQuantity));
  const included = Math.max(0, Math.floor(m.includedSeats));
  const additionalSeats = Math.max(0, seats - included);
  const additionalSeatTotal = additionalSeats * m.additionalSeatPrice;
  return {
    basePrice: m.basePrice,
    includedSeats: included,
    seatQuantity: seats,
    additionalSeats,
    additionalSeatPrice: m.additionalSeatPrice,
    additionalSeatTotal,
    totalPrice: m.basePrice + additionalSeatTotal,
  };
}
