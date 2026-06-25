// Plan catalog (reference data). Prices are per-seat per month in USD cents.
export const PLAN_CATALOG = [
  { id: "free", name: "Free", pricePerSeat: 0, seatLimit: 10, color: "#64748b", sortOrder: 0, features: ["core"] },
  { id: "starter", name: "Starter", pricePerSeat: 800, seatLimit: 50, color: "#3fa45b", sortOrder: 1, features: ["core", "time_tracking", "attendance"] },
  { id: "growth", name: "Growth", pricePerSeat: 1400, seatLimit: 200, color: "#1f883d", sortOrder: 2, features: ["core", "time_tracking", "attendance", "ai_analytics"] },
  { id: "enterprise", name: "Enterprise", pricePerSeat: 2200, seatLimit: null as number | null, color: "#14532d", sortOrder: 3, features: ["core", "time_tracking", "attendance", "ai_analytics", "sso", "priority_support"] },
];
