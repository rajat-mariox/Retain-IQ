"use client";

import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import type { OrgChartNode } from "@/lib/api";

const initials = (n: string) => n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

function Node({ node, depth }: { node: OrgChartNode; depth: number }) {
  return (
    <li>
      <Link href={`/employees/${node.id}`} className="inline-flex items-center gap-2.5 rounded-xl border border-hairline bg-panel px-3 py-2 hover:border-brand/40 hover:bg-slate-50">
        <span className="grid size-8 place-items-center rounded-lg bg-brand/10 text-[11px] font-semibold text-brand">{initials(node.name)}</span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-900">{node.name}</span>
          <span className="block text-xs text-slate-500">{node.title ?? "—"}{node.department ? ` · ${node.department}` : ""}</span>
        </span>
        {node.reports.length ? <span className="ml-1 rounded-full bg-panel-2 px-1.5 text-xs tabular-nums text-slate-500">{node.reports.length}</span> : null}
      </Link>
      {node.reports.length ? (
        <ul className={`mt-2 space-y-2 border-l border-hairline ${depth < 6 ? "pl-5" : "pl-2"}`}>
          {node.reports.map((r) => <Node key={r.id} node={r} depth={depth + 1} />)}
        </ul>
      ) : null}
    </li>
  );
}

export function OrgChartView({ roots, total }: { roots: OrgChartNode[]; total: number }) {
  return (
    <Card>
      <CardHeader title="Reporting hierarchy" subtitle={`${total} people · reports-to structure`} />
      <div className="p-5">
        {roots.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No employees yet. Assign reporting managers on employee profiles to build the chart.</p>
        ) : (
          <ul className="space-y-3">{roots.map((r) => <Node key={r.id} node={r} depth={0} />)}</ul>
        )}
      </div>
    </Card>
  );
}
