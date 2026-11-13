"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronRight, Search } from "lucide-react";
import type { Organization } from "@/lib/data/types";
import { PlanBadge, StatusBadge, type PlanLookup } from "@/components/ui/badges";
import { PaginationBar } from "@/components/ui/Pagination";
import { cn } from "@/lib/cn";
import { formatBytes, formatDate, formatNumber, timeAgo } from "@/lib/format";

const PAGE_SIZE = 10;

type SortKey = "name" | "users" | "activeUsers" | "seats" | "storageUsedBytes" | "renewsAt" | "lastActiveAt";

interface OrgsTableProps {
  organizations: Organization[];
  /** Fixed "now" from the server so timeAgo is stable across hydration. */
  now: number;
  /** Live plan name/colour by id — this is a client component, so the server page passes it in. */
  plans?: PlanLookup;
}

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "name", label: "Organization", align: "left" },
  { key: "users", label: "Users", align: "right" },
  { key: "activeUsers", label: "Active (30d)", align: "right" },
  { key: "seats", label: "Seats", align: "right" },
  { key: "storageUsedBytes", label: "Storage", align: "right" },
  { key: "renewsAt", label: "Renews", align: "right" },
  { key: "lastActiveAt", label: "Last active", align: "right" },
];

export function OrgsTable({ organizations, now, plans }: OrgsTableProps) {
  const [query, setQuery] = useState("");
  // Biggest accounts first — the ones worth a Super Admin's attention.
  const [sortKey, setSortKey] = useState<SortKey>("activeUsers");
  const [asc, setAsc] = useState(false);
  const [page, setPage] = useState(1);

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

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  function toggleSort(key: SortKey) {
    setPage(1);
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
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
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
            {total === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-5 py-8 text-center text-sm text-slate-500">
                  No organizations match.
                </td>
              </tr>
            ) : null}
            {pageRows.map((o) => (
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
                        {o.plan ? <PlanBadge plan={o.plan} plans={plans} /> : null}
                      </span>
                    </div>
                  </Link>
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatNumber(o.users)}</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatNumber(o.activeUsers)}</td>
                <td className="px-5 py-3 text-right"><SeatsCell active={o.activeUsers} seats={o.seats} /></td>
                <td className="px-5 py-3 text-right"><StorageCell used={o.storageUsedBytes} limit={o.storageLimitBytes} /></td>
                <td className="px-5 py-3 text-right"><RenewalCell org={o} now={now} /></td>
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

      <PaginationBar
        page={current}
        pageCount={pageCount}
        from={total ? start + 1 : 0}
        to={Math.min(start + PAGE_SIZE, total)}
        total={total}
        onPage={setPage}
      />
    </div>
  );
}

/** Seats bought vs actually used — under-use is a churn signal, full is an upsell. */
function SeatsCell({ active, seats }: { active: number; seats?: number | null }) {
  if (!seats) return <span className="text-slate-400">—</span>;
  const pct = Math.min(100, Math.round((active / seats) * 100));
  const tone = pct >= 70 ? "#16a34a" : pct >= 30 ? "#d97706" : "#e5484d";
  return (
    <div className="inline-flex items-center justify-end gap-2">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-panel-2">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: tone }} />
      </span>
      <span className="tabular-nums text-slate-700">
        {active}/{seats}
      </span>
    </div>
  );
}

/** Storage against the plan cap — the overage/upsell trigger. */
function StorageCell({ used, limit }: { used?: number; limit?: number | null }) {
  const bytes = used ?? 0;
  if (!limit) return <span className="tabular-nums text-slate-700">{formatBytes(bytes)}</span>;
  const pct = Math.min(100, Math.round((bytes / limit) * 100));
  return (
    <span className="inline-flex flex-col items-end">
      <span className="tabular-nums text-slate-700">{formatBytes(bytes)}</span>
      <span className={`text-[11px] tabular-nums ${pct >= 80 ? "text-rose-600" : "text-slate-400"}`}>{pct}% of quota</span>
    </span>
  );
}

/**
 * When the money next moves. A trial shows its expiry instead — that's the date
 * that actually matters for a prospect, and it's the one that turns them paying.
 */
function RenewalCell({ org, now }: { org: Organization; now: number }) {
  const trial = org.subscriptionStatus === "TRIALING" && org.trialEndsAt;
  const iso = trial ? org.trialEndsAt : org.renewsAt;
  if (!iso) return <span className="text-slate-400">—</span>;
  const days = Math.ceil((Date.parse(iso) - now) / 86_400_000);
  const soon = days <= 7;
  return (
    <span className="inline-flex flex-col items-end">
      <span className={`text-xs tabular-nums ${soon ? "font-medium text-amber-700" : "text-slate-600"}`}>{formatDate(iso)}</span>
      <span className="text-[11px] text-slate-400">
        {trial ? "trial ends " : ""}
        {days < 0 ? "overdue" : days === 0 ? "today" : `in ${days}d`}
      </span>
    </span>
  );
}
