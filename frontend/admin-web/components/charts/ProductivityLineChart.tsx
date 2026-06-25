"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { UsagePoint } from "@/lib/data/types";
import { AXIS_TICK, GRID_STROKE, shortDate, TOOLTIP_PROPS } from "./chart-kit";

export function ProductivityLineChart({ data }: { data: UsagePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis domain={[50, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} unit="%" />
        <Tooltip
          {...TOOLTIP_PROPS}
          labelFormatter={(label) => shortDate(String(label))}
          formatter={(value: number) => [`${value}%`, "Avg productivity"]}
        />
        <Line
          type="monotone"
          dataKey="avgProductivity"
          stroke="#1f883d"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4, fill: "#1f883d" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
