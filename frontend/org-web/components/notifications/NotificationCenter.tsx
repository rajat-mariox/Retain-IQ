"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle, Archive, ArchiveRestore, Bell, BrainCircuit, CalendarCheck,
  CheckCheck, FolderKanban, Gauge, Search, Settings2, Users,
} from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { LocalTime } from "@/components/ui/LocalTime";
import { cn } from "@/lib/cn";
import { timeAgo } from "@/lib/format";
import type { InboxNotification, NotificationStats } from "@/lib/api";

const CATEGORIES = [
  { key: "", label: "All", icon: Bell },
  { key: "ATTENDANCE", label: "Attendance", icon: CalendarCheck },
  { key: "PROJECT", label: "Project", icon: FolderKanban },
  { key: "PRODUCTIVITY", label: "Productivity", icon: Gauge },
  { key: "AI", label: "AI", icon: BrainCircuit },
  { key: "SYSTEM", label: "System", icon: Settings2 },
] as const;

const CAT_TINT: Record<string, string> = {
  ATTENDANCE: "bg-sky-500/10 text-sky-700 ring-sky-600/20",
  PROJECT: "bg-violet-500/10 text-violet-700 ring-violet-600/20",
  PRODUCTIVITY: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  AI: "bg-fuchsia-500/10 text-fuchsia-700 ring-fuchsia-600/20",
  SYSTEM: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
};
const PRIORITY_TINT: Record<string, string> = {
  CRITICAL: "bg-rose-500/10 text-rose-700 ring-rose-600/20",
  HIGH: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  NORMAL: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
  LOW: "bg-slate-500/10 text-slate-400 ring-slate-500/20",
};

const btn = "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors";
const btnGhost = cn(btn, "border border-hairline bg-panel text-slate-700 hover:bg-panel-2");
const select = "rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-sm text-slate-700 focus:border-brand focus:outline-none";

function pill(map: Record<string, string>, k: string) {
  return cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", map[k] ?? "bg-panel-2 text-slate-600 ring-hairline");
}
function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Card>
      <CardBody className="p-4">
        <p className="text-xs text-slate-500">{label}</p>
        <p className={cn("mt-1 text-2xl font-semibold", tone ?? "text-slate-900")}>{value}</p>
      </CardBody>
    </Card>
  );
}

const PAGE_SIZE = 15;

export function NotificationCenter({
  initialItems,
  initialTotal,
  initialStats,
  canViewWorkspace = false,
}: {
  initialItems: InboxNotification[];
  initialTotal: number;
  initialStats: NotificationStats;
  canViewWorkspace?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [stats, setStats] = useState(initialStats);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("");
  const [unread, setUnread] = useState(false);
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const now = Date.now();

  const load = useCallback(async (p: number, f: { category: string; priority: string; unread: boolean; archived: boolean; q: string }) => {
    setBusy(true);
    const qs = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) });
    if (f.category) qs.set("category", f.category);
    if (f.priority) qs.set("priority", f.priority);
    if (f.unread) qs.set("unread", "true");
    if (f.archived) qs.set("archived", "true");
    if (f.q.trim()) qs.set("q", f.q.trim());
    const [listRes, statsRes] = await Promise.all([
      fetch(`/api/notifications?${qs}`, { cache: "no-store" }),
      fetch("/api/notifications/stats", { cache: "no-store" }),
    ]);
    if (listRes.ok) {
      const d = (await listRes.json()) as { items: InboxNotification[]; total: number };
      setItems(d.items ?? []);
      setTotal(d.total ?? 0);
    }
    if (statsRes.ok) setStats((await statsRes.json()) as NotificationStats);
    setBusy(false);
  }, []);

  // Debounced re-fetch whenever a filter changes.
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); load(1, { category, priority, unread, archived, q }); }, 250);
    return () => clearTimeout(t);
  }, [category, priority, unread, archived, q, load]);

  const refresh = () => { load(page, { category, priority, unread, archived, q }); router.refresh(); };

  async function act(url: string) {
    setBusy(true);
    await fetch(url, { method: "POST" });
    await load(page, { category, priority, unread, archived, q });
    router.refresh(); // keep the bell badge in sync
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      {/* §1 Notifications Dashboard */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Total" value={stats.total} />
        <Tile label="Unread" value={stats.unread} tone="text-brand" />
        <Tile label="Critical alerts" value={stats.critical} tone={stats.critical > 0 ? "text-rose-600" : undefined} />
        <Tile label="AI alerts" value={stats.categories?.AI ?? 0} tone="text-fuchsia-600" />
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {CATEGORIES.map(({ key, label, icon: Icon }) => (
          <button
            key={key || "all"}
            type="button"
            onClick={() => setCategory(key)}
            className={cn(btn, "border", category === key ? "border-slate-900 bg-slate-900 text-white" : "border-hairline bg-panel text-slate-600 hover:bg-panel-2")}
          >
            <Icon className="size-3.5" /> {label}
            {key && stats.categories?.[key] ? <span className="ml-0.5 rounded-full bg-black/10 px-1.5 text-[10px] tabular-nums">{stats.categories[key]}</span> : null}
          </button>
        ))}
      </div>

      {/* §2 Filters, search, bulk actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notifications…" className="w-56 rounded-lg border border-hairline bg-panel py-1.5 pl-8 pr-3 text-sm text-slate-900 focus:border-brand focus:outline-none" />
        </div>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className={select}>
          <option value="">All priorities</option>
          {["CRITICAL", "HIGH", "NORMAL", "LOW"].map((p) => <option key={p} value={p}>{p.toLowerCase()}</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} className="size-4 rounded border-hairline text-brand focus:ring-brand" /> Unread only
        </label>
        <label className="inline-flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} className="size-4 rounded border-hairline text-brand focus:ring-brand" /> Archived
        </label>
        {(q || priority || unread || archived || category) ? (
          <button onClick={() => { setQ(""); setPriority(""); setUnread(false); setArchived(false); setCategory(""); }} className="text-xs text-slate-500 hover:text-slate-800">Clear</button>
        ) : null}

        <div className="ml-auto flex gap-2">
          {canViewWorkspace ? (
            <Link href="/notifications/workspace" className={btnGhost}><Users className="size-3.5" /> Team feed</Link>
          ) : null}
          <button type="button" className={btnGhost} disabled={busy} onClick={() => act("/api/notifications/read-all")}><CheckCheck className="size-3.5" /> Mark all read</button>
          <button type="button" className={btnGhost} disabled={busy} onClick={() => act("/api/notifications/archive-read")}><Archive className="size-3.5" /> Archive read</button>
        </div>
      </div>

      {/* Feed */}
      <Card>
        <ul className="divide-y divide-hairline/60">
          {items.map((n) => {
            const isUnread = !n.readAt;
            const isCritical = n.priority === "CRITICAL";
            return (
              <li key={n.id} className={cn("flex items-start gap-3 px-5 py-4", isUnread && "bg-brand/[0.03]")}>
                <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset", isCritical ? "bg-rose-500/10 text-rose-600 ring-rose-600/20" : isUnread ? "bg-brand/10 text-brand ring-brand/20" : "bg-panel-2 text-slate-400 ring-hairline")}>
                  {isCritical ? <AlertTriangle className="size-4" /> : <Bell className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className={cn("text-sm", isUnread ? "font-semibold text-slate-900" : "font-medium text-slate-700")}>{n.title}</p>
                    <span className="shrink-0 text-xs text-slate-400" title={n.createdAt}>{timeAgo(n.createdAt, now)}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-slate-500">{n.body}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className={pill(CAT_TINT, n.category)}>{n.category.toLowerCase()}</span>
                    {n.priority !== "NORMAL" ? <span className={pill(PRIORITY_TINT, n.priority)}>{n.priority.toLowerCase()}</span> : null}
                    <span className="text-[11px] text-slate-400"><LocalTime iso={n.createdAt} mode="datetime" /></span>
                    {n.link ? <Link href={n.link} className="text-[11px] font-medium text-brand hover:underline">View →</Link> : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {isUnread && n.id !== "platform-announcement" ? (
                    <button onClick={() => act(`/api/notifications/${n.id}/read`)} disabled={busy} className="text-[11px] text-slate-500 hover:text-slate-800">Mark read</button>
                  ) : null}
                  {n.id !== "platform-announcement" ? (
                    n.archivedAt ? (
                      <button onClick={() => act(`/api/notifications/${n.id}/unarchive`)} disabled={busy} title="Restore" className="text-slate-300 hover:text-slate-700"><ArchiveRestore className="size-4" /></button>
                    ) : (
                      <button onClick={() => act(`/api/notifications/${n.id}/archive`)} disabled={busy} title="Dismiss" className="text-slate-300 hover:text-slate-700"><Archive className="size-4" /></button>
                    )
                  ) : null}
                </div>
              </li>
            );
          })}
          {items.length === 0 ? (
            <li className="px-5 py-12 text-center text-sm text-slate-500">
              {archived ? "Nothing archived." : q || category || priority || unread ? "No notifications match those filters." : "You're all caught up — no notifications."}
            </li>
          ) : null}
        </ul>

        {pages > 1 ? (
          <div className="flex items-center justify-between border-t border-hairline px-5 py-3 text-sm">
            <span className="text-slate-500">Page {page} of {pages} · {total} total</span>
            <div className="flex gap-2">
              <button className={btnGhost} disabled={page <= 1 || busy} onClick={() => { const p = page - 1; setPage(p); load(p, { category, priority, unread, archived, q }); }}>Previous</button>
              <button className={btnGhost} disabled={page >= pages || busy} onClick={() => { const p = page + 1; setPage(p); load(p, { category, priority, unread, archived, q }); }}>Next</button>
            </div>
          </div>
        ) : null}
      </Card>

      <p className="text-xs text-slate-400">
        Delivery channels and quiet hours are configured in <Link href="/settings/notifications" className="font-medium text-brand hover:underline">Notification settings</Link>.
        <button onClick={refresh} className="ml-2 text-slate-400 hover:text-slate-600">Refresh</button>
      </p>
    </div>
  );
}
