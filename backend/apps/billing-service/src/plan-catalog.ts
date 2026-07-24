// Plan catalog (reference data). Prices are per-seat per month in USD cents.
// storageLimitMb is the screenshot-storage quota (null = unlimited).
const GB = 1024;
export const PLAN_CATALOG = [
  { id: "free", name: "Free", pricePerSeat: 0, seatLimit: 10, storageLimitMb: 5 * GB, color: "#64748b", sortOrder: 0, features: ["core"] },
  { id: "basic", name: "Basic", pricePerSeat: 800, seatLimit: 50, storageLimitMb: 15 * GB, color: "#3fa45b", sortOrder: 1, features: ["core", "time_tracking", "attendance"] },
  { id: "professional", name: "Professional", pricePerSeat: 1400, seatLimit: 200, storageLimitMb: 25 * GB, color: "#1f883d", sortOrder: 2, features: ["core", "time_tracking", "attendance", "ai_analytics", "recruitment"] },
  { id: "enterprise", name: "Enterprise", pricePerSeat: 2200, seatLimit: null as number | null, storageLimitMb: null as number | null, color: "#14532d", sortOrder: 3, features: ["core", "time_tracking", "attendance", "ai_analytics", "recruitment", "monitoring", "sso", "priority_support"] },
];
