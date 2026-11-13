"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MrrPoint } from "@/lib/data/types";
import { AXIS_TICK, GRID_STROKE, TOOLTIP_PROPS } from "./chart-kit";

// New vs. churned MRR per month. Churn is rendered as a negative value so the
// bars read as expansion (up) vs. contraction (down) around the zero line.
export function NetMrrBars({ data }: { data: MrrPoint[] }) {
  const shaped = data.map((d) => ({ month: d.month, newMrr: d.newMrr, churnedMrr: -d.churnedMrr }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={shaped} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} stackOffset="sign">
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip
          {...TOOLTIP_PROPS}
          formatter={(value: number, name) => [
            `$${Math.abs(value).toLocaleString()}`,
            name === "newMrr" ? "New MRR" : "Churned MRR",
          ]}
        />
        <Legend
          iconType="circle"
          formatter={(value) => (value === "newMrr" ? "New MRR" : "Churned MRR")}
          wrapperStyle={{ fontSize: 12, color: "#94a3b8" }}
        />
        <Bar dataKey="newMrr" stackId="net" fill="#2da44e" radius={[4, 4, 0, 0]} />
        <Bar dataKey="churnedMrr" stackId="net" fill="#e5484d" radius={[0, 0, 4, 4]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
