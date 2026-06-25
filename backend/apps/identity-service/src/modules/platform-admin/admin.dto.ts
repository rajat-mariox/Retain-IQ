// Response shapes for the platform-admin reporting API. These mirror what the
// admin-web dashboard renders, so the frontend data layer maps 1:1.

export interface AdminOverview {
  totalOrgs: number;
  activeOrgs: number;
  suspendedOrgs: number;
  newOrgsThisMonth: number;
  totalUsers: number;
  totalEmployees: number;
  avgProductivity: number;
  trackedOrgs: number;
}

export interface AdminOrg {
  id: string;
  name: string;
  slug: string;
  status: string;
  users: number;
  employees: number;
  avgProductivity: number;
  activeHours: number;
  createdAt: string;
  lastActiveAt: string | null;
  plan: string | null;
  subscriptionStatus: string | null;
  region?: string;
  timezone?: string;
}

export interface AdminPlanDist {
  plan: string;
  name: string;
  orgs: number;
  seats: number;
  mrr: number;
  color: string;
}

export interface AdminRevenue {
  mrr: number;
  arr: number;
  arpa: number;
  churnRatePct: number;
  growthRatePct: number;
  netRevenueRetentionPct: number;
  payingOrgs: number;
  totalOrgs: number;
  totalSeats: number;
}

export interface AdminMrrPoint {
  month: string;
  mrr: number;
  newMrr: number;
  churnedMrr: number;
}

export interface AdminBilling {
  plans: AdminPlanDist[];
  revenue: AdminRevenue;
  trend: AdminMrrPoint[];
}

export interface AdminUsagePoint {
  date: string;
  activeHours: number;
  idleHours: number;
  productiveHours: number;
  avgProductivity: number;
}

export interface AdminTopOrg {
  id: string;
  name: string;
  activeHours: number;
  avgProductivity: number;
}

export interface AdminUsage {
  series: AdminUsagePoint[];
  topOrgs: AdminTopOrg[];
  totals: { activeHours: number; idleHours: number; productiveHours: number; avgProductivity: number };
}

export interface AdminEmployee {
  id: string;
  name: string;
  email: string | null;
  status: string;
  avgProductivity: number;
  activeHours: number;
  productiveHours: number;
  lastActiveDay: string | null;
  // Attendance (last 30 days).
  attendanceRate: number;
  daysPresent: number;
  todayStatus: string | null;
}

export interface AdminAttendanceToday {
  totalEmployees: number;
  present: number;
  late: number;
  absent: number;
  onLeave: number;
  attendanceRate: number;
}

export interface AdminOrgDetail {
  org: AdminOrg;
  employees: AdminEmployee[];
  attendanceToday: AdminAttendanceToday;
}
