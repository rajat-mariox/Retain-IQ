"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { UsagePoint } from "@/lib/data/types";
import { AXIS_TICK, GRID_STROKE, shortDate, TOOLTIP_PROPS } from "./chart-kit";

export function UsageAreaChart({ data }: { data: UsagePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id="activeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1f883d" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#1f883d" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="idleFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#94a3b8" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} />
        <Tooltip
          {...TOOLTIP_PROPS}
          labelFormatter={(label) => shortDate(String(label))}
          formatter={(value: number, name) => [`${value.toLocaleString()} h`, name === "activeHours" ? "Active" : "Idle"]}
        />
        <Area type="monotone" dataKey="activeHours" stroke="#1f883d" strokeWidth={2} fill="url(#activeFill)" />
        <Area type="monotone" dataKey="idleHours" stroke="#94a3b8" strokeWidth={2} fill="url(#idleFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
