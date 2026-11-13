"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MrrPoint } from "@/lib/data/types";
import { AXIS_TICK, GRID_STROKE, TOOLTIP_PROPS } from "./chart-kit";

export function MrrAreaChart({ data }: { data: MrrPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="mrrFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1f883d" stopOpacity={0.42} />
            <stop offset="100%" stopColor="#1f883d" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip {...TOOLTIP_PROPS} formatter={(value: number) => [`$${value.toLocaleString()}`, "MRR"]} />
        <Area type="monotone" dataKey="mrr" stroke="#1f883d" strokeWidth={2.5} fill="url(#mrrFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
