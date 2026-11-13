// Plan catalog (reference data). Amounts are USD cents.
//
// Pricing model: total = basePrice + max(0, seats - includedSeats) * additionalSeatPrice.
// Seeded values below keep the historical FLAT per-seat behaviour (basePrice 0,
// includedSeats 0, additionalSeatPrice = the old per-seat price), so nothing changes
// until a super-admin edits a plan to a real base/included model in admin-web.
// storageLimitMb is the screenshot-storage quota (null = unlimited).
const GB = 1024;
export const PLAN_CATALOG = [
  { id: "free",         name: "Free",         pricePerSeat: 0,    basePrice: 0, includedSeats: 0, additionalSeatPrice: 0,    minSeats: 1, maxSeats: 10 as number | null,  seatLimit: 10 as number | null,  allowCustomSeats: false, storageLimitMb: 5 * GB,          color: "#64748b", sortOrder: 0, features: ["core"] },
  { id: "basic",        name: "Basic",        pricePerSeat: 800,  basePrice: 0, includedSeats: 0, additionalSeatPrice: 800,  minSeats: 1, maxSeats: 50 as number | null,  seatLimit: 50 as number | null,  allowCustomSeats: true,  storageLimitMb: 15 * GB,         color: "#3fa45b", sortOrder: 1, features: ["core", "time_tracking", "attendance"] },
  { id: "professional", name: "Professional", pricePerSeat: 1400, basePrice: 0, includedSeats: 0, additionalSeatPrice: 1400, minSeats: 1, maxSeats: 200 as number | null, seatLimit: 200 as number | null, allowCustomSeats: true,  storageLimitMb: 25 * GB,         color: "#1f883d", sortOrder: 2, features: ["core", "time_tracking", "attendance", "ai_analytics", "recruitment"] },
  { id: "enterprise",   name: "Enterprise",   pricePerSeat: 2200, basePrice: 0, includedSeats: 0, additionalSeatPrice: 2200, minSeats: 1, maxSeats: null as number | null, seatLimit: null as number | null, allowCustomSeats: true,  storageLimitMb: null as number | null, color: "#14532d", sortOrder: 3, features: ["core", "time_tracking", "attendance", "ai_analytics", "recruitment", "monitoring", "sso", "priority_support"] },
];
