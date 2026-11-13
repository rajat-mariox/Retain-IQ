"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS_TICK, GRID_STROKE, TOOLTIP_PROPS } from "./chart-kit";
import type { ApiGrowthPoint, ApiSeatPoint, ApiStoragePoint } from "@/lib/admin-api";

const MB = 1024 * 1024;
const fmtBytes = (b: number) => (b >= 1024 * MB ? `${(b / (1024 * MB)).toFixed(1)} GB` : `${(b / MB).toFixed(0)} MB`);

/**
 * Cumulative tenants and users. The running total — not the per-month bar — is
 * the growth curve a founder reads: it shows whether the platform is compounding.
 */
export function GrowthAreaChart({ data }: { data: ApiGrowthPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
        <defs>
          <linearGradient id="orgFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1f883d" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#1f883d" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="userFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0d9488" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#0d9488" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip {...TOOLTIP_PROPS} />
        <Area type="monotone" dataKey="totalUsers" name="Users" stroke="#0d9488" strokeWidth={2} fill="url(#userFill)" />
        <Area type="monotone" dataKey="totalOrgs" name="Organizations" stroke="#1f883d" strokeWidth={2} fill="url(#orgFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** New tenants per month — the acquisition rate behind the curve above. */
export function NewOrgsBars({ data }: { data: ApiGrowthPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip {...TOOLTIP_PROPS} />
        <Bar dataKey="orgs" name="New organizations" fill="#1f883d" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Storage is an infra cost curve — this is what the platform is paying to hold. */
export function StorageAreaChart({ data }: { data: ApiStoragePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -6 }}>
        <defs>
          <linearGradient id="storeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.32} />
            <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={fmtBytes} width={62} />
        <Tooltip {...TOOLTIP_PROPS} formatter={(v: number) => fmtBytes(v)} />
        <Area type="monotone" dataKey="totalBytes" name="Stored" stroke="#6366f1" strokeWidth={2} fill="url(#storeFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Seats sold vs seats used, per plan. The gap is the story: a wide gap on a big
 * plan is churn risk; a plan at capacity is an upsell.
 */
export function SeatUtilizationBars({ data }: { data: ApiSeatPoint[] }) {
  if (data.length === 0) return <p className="py-10 text-center text-sm text-slate-500">No subscriptions yet.</p>;
  return (
    <div className="space-y-3">
      {data.map((p) => {
        const pct = p.seatsSold > 0 ? Math.round((p.seatsUsed / p.seatsSold) * 100) : 0;
        const tone = pct >= 80 ? "#16a34a" : pct >= 40 ? "#d97706" : "#e5484d";
        return (
          <div key={p.planName}>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="font-medium text-slate-700">
                {p.planName} <span className="font-normal text-slate-400">· {p.orgs} org{p.orgs === 1 ? "" : "s"}</span>
              </span>
              <span className="tabular-nums text-slate-500">
                {p.seatsUsed} of {p.seatsSold} seats · {pct}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: tone }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
