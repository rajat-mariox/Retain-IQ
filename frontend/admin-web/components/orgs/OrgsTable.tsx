"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronRight, Search } from "lucide-react";
import type { Organization } from "@/lib/data/types";
import { PlanBadge, StatusBadge } from "@/components/ui/badges";
import { cn } from "@/lib/cn";
import { formatCompact, formatNumber, timeAgo } from "@/lib/format";

type SortKey = "name" | "users" | "employees" | "avgProductivity" | "activeHours" | "lastActiveAt";

interface OrgsTableProps {
  organizations: Organization[];
  /** Fixed "now" from the server so timeAgo is stable across hydration. */
  now: number;
}

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "name", label: "Organization", align: "left" },
  { key: "users", label: "Users", align: "right" },
  { key: "employees", label: "Employees", align: "right" },
  { key: "avgProductivity", label: "Productivity", align: "right" },
  { key: "activeHours", label: "Active hrs (30d)", align: "right" },
  { key: "lastActiveAt", label: "Last active", align: "right" },
];

export function OrgsTable({ organizations, now }: OrgsTableProps) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("activeHours");
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? organizations.filter((o) => o.name.toLowerCase().includes(q)) : organizations;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? (sortKey === "name" ? "" : 0);
      const bv = b[sortKey] ?? (sortKey === "name" ? "" : 0);
      const cmp =
        typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : Number(av ?? 0) - Number(bv ?? 0);
      return asc ? cmp : -cmp;
    });
  }, [organizations, query, sortKey, asc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setAsc((v) => !v);
    } else {
      setSortKey(key);
      setAsc(key === "name");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 border-b border-hairline px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">All organizations</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {rows.length} of {organizations.length} shown · live
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-hairline bg-panel-2/60 px-3 py-2 text-sm">
          <Search className="size-4 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name…"
            className="w-44 bg-transparent text-slate-800 placeholder:text-slate-400 focus:outline-none sm:w-56"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-hairline text-xs text-slate-500">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={cn("px-5 py-3 font-medium", col.align === "right" ? "text-right" : "text-left")}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className={cn(
                      "inline-flex items-center gap-1 transition-colors hover:text-slate-800",
                      col.align === "right" && "flex-row-reverse",
                      sortKey === col.key && "text-slate-800",
                    )}
                  >
                    {col.label}
                    {sortKey === col.key ? asc ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
                  </button>
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr
                key={o.id}
                className="group border-b border-hairline/60 transition-colors last:border-0 hover:bg-slate-50"
              >
                <td className="px-5 py-3">
                  <Link href={`/organizations/${o.id}`} className="flex items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-panel-2 text-[11px] font-semibold text-slate-700 ring-1 ring-inset ring-hairline">
                      {o.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <span className="block truncate font-medium text-slate-900 group-hover:text-brand">{o.name}</span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <StatusBadge status={o.status} />
                        {o.plan ? <PlanBadge plan={o.plan} /> : null}
                      </span>
                    </div>
                  </Link>
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatNumber(o.users)}</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatNumber(o.employees)}</td>
                <td className="px-5 py-3 text-right">
                  {o.avgProductivity > 0 ? (
                    <ProductivityCell value={o.avgProductivity} />
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatCompact(o.activeHours)}</td>
                <td className="px-5 py-3 text-right text-xs text-slate-500">
                  {o.lastActiveAt ? timeAgo(o.lastActiveAt, now) : "—"}
                </td>
                <td className="px-2 text-right">
                  <Link
                    href={`/organizations/${o.id}`}
                    className="inline-grid place-items-center text-slate-400 hover:text-brand"
                  >
                    <ChevronRight className="size-4" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProductivityCell({ value }: { value: number }) {
  const tone = value >= 80 ? "#16a34a" : value >= 65 ? "#d97706" : "#e5484d";
  return (
    <div className="inline-flex items-center justify-end gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-panel-2">
        <span className="block h-full rounded-full" style={{ width: `${value}%`, backgroundColor: tone }} />
      </span>
      <span className="w-8 tabular-nums text-slate-700">{value}%</span>
    </div>
  );
}
