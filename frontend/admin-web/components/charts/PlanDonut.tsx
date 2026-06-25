"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { PlanDistribution } from "@/lib/data/types";
import { TOOLTIP_PROPS } from "./chart-kit";

interface PlanDonutProps {
  data: PlanDistribution[];
  /** Which metric drives the slice size. */
  metric?: "orgs" | "mrr";
}

export function PlanDonut({ data, metric = "orgs" }: PlanDonutProps) {
  const total = data.reduce((sum, d) => sum + d[metric], 0);

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Tooltip
            {...TOOLTIP_PROPS}
            formatter={(value: number, _name, item) => [
              metric === "mrr" ? `$${value.toLocaleString()}` : `${value} orgs`,
              (item as { payload?: { name?: string } })?.payload?.name ?? "",
            ]}
          />
          <Pie
            data={data}
            dataKey={metric}
            nameKey="name"
            innerRadius={66}
            outerRadius={96}
            paddingAngle={2}
            stroke="none"
          >
            {data.map((d) => (
              <Cell key={d.plan} fill={d.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="text-center">
          <p className="text-2xl font-semibold text-slate-900">
            {metric === "mrr" ? `$${(total / 1000).toFixed(1)}k` : total}
          </p>
          <p className="text-[11px] uppercase tracking-wider text-slate-500">{metric === "mrr" ? "MRR" : "Orgs"}</p>
        </div>
      </div>
    </div>
  );
}
