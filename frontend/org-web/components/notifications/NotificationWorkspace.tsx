"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Search, ShieldCheck } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { LocalTime } from "@/components/ui/LocalTime";
import { cn } from "@/lib/cn";
import type { OrgFeed } from "@/lib/api";

const CATEGORIES = ["", "ATTENDANCE", "PROJECT", "PRODUCTIVITY", "AI", "SYSTEM"];
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
function Tile({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <Card>
      <CardBody className="p-4">
        <p className="text-xs text-slate-500">{label}</p>
        <p className={cn("mt-1 text-2xl font-semibold", tone ?? "text-slate-900")}>{value}</p>
      </CardBody>
    </Card>
  );
}

const PAGE_SIZE = 20;

/**
 * Org-wide alert feed. Managers see it as their team workspace (§9); Owners as
 * the org admin workspace (§10) with the delivery-policy panel.
 */
export function NotificationWorkspace({ initial, isOwner }: { initial: OrgFeed; isOwner: boolean }) {
  const [feed, setFeed] = useState(initial);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (p: number, f: { category: string; priority: string; q: string }) => {
    setBusy(true);
    const qs = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) });
    if (f.category) qs.set("category", f.category);
    if (f.priority) qs.set("priority", f.priority);
    if (f.q.trim()) qs.set("q", f.q.trim());
    const res = await fetch(`/api/notifications/org-feed?${qs}`, { cache: "no-store" });
    if (res.ok) setFeed((await res.json()) as OrgFeed);
    setBusy(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); load(1, { category, priority, q }); }, 250);
    return () => clearTimeout(t);
  }, [category, priority, q, load]);

  const cats = feed.summary?.categories ?? {};
  const prios = feed.summary?.priorities ?? {};
  const pages = Math.max(1, Math.ceil(feed.total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Alerts (org)" value={feed.total} />
        <Tile label="Critical" value={prios.CRITICAL ?? 0} tone={(prios.CRITICAL ?? 0) > 0 ? "text-rose-600" : undefined} />
        <Tile label="High priority" value={prios.HIGH ?? 0} tone="text-amber-600" />
        <Tile label="AI recommendations" value={cats.AI ?? 0} tone="text-fuchsia-600" />
      </div>

      {/* §10 org delivery policy — Owner only */}
      {isOwner ? (
        <Card>
          <CardHeader title="Delivery policy" subtitle="Organisation-wide notification rules" />
          <CardBody className="space-y-3 text-sm">
            <div className="flex items-start gap-2.5 rounded-lg border border-hairline bg-panel-2 px-3 py-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <div>
                <p className="font-medium text-slate-800">Channel defaults</p>
                <p className="text-xs text-slate-500">
                  Attendance and System alerts default to in-app + email; Project, Productivity and AI to in-app only.
                  Members can widen or narrow this for themselves in <Link href="/settings/notifications" className="font-medium text-brand hover:underline">Notification settings</Link>.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 rounded-lg border border-hairline bg-panel-2 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-medium text-slate-800">Escalation</p>
                <p className="text-xs text-slate-500">
                  Leave requests and task assignments escalate to approvers on in-app, email and push.
                  Quiet hours hold email and push; in-app is always delivered so nothing is lost.
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search alerts…" className="w-56 rounded-lg border border-hairline bg-panel py-1.5 pl-8 pr-3 text-sm text-slate-900 focus:border-brand focus:outline-none" />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={select}>
          {CATEGORIES.map((c) => <option key={c || "all"} value={c}>{c ? `${c.toLowerCase()}${cats[c] ? ` (${cats[c]})` : ""}` : "All categories"}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className={select}>
          <option value="">All priorities</option>
          {["CRITICAL", "HIGH", "NORMAL", "LOW"].map((p) => <option key={p} value={p}>{p.toLowerCase()}</option>)}
        </select>
        {(q || category || priority) ? <button onClick={() => { setQ(""); setCategory(""); setPriority(""); }} className="text-xs text-slate-500 hover:text-slate-800">Clear</button> : null}
      </div>

      <Card>
        <CardHeader title="Team alert feed" subtitle="Every alert raised across the organisation" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-xs text-slate-500">
                <th className="px-5 py-3 text-left font-medium">Alert</th>
                <th className="px-5 py-3 text-left font-medium">Recipient</th>
                <th className="px-5 py-3 text-left font-medium">Category</th>
                <th className="px-5 py-3 text-left font-medium">Priority</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {feed.items.map((n) => (
                <tr key={n.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-900">{n.title}</p>
                    <p className="text-xs text-slate-500">{n.body}</p>
                    {n.link ? <Link href={n.link} className="text-[11px] font-medium text-brand hover:underline">View →</Link> : null}
                  </td>
                  <td className="px-5 py-3"><p className="text-slate-700">{n.recipientName}</p><p className="text-xs text-slate-400">{n.recipientRole}</p></td>
                  <td className="px-5 py-3"><span className={pill(CAT_TINT, n.category)}>{n.category.toLowerCase()}</span></td>
                  <td className="px-5 py-3"><span className={pill(PRIORITY_TINT, n.priority)}>{n.priority.toLowerCase()}</span></td>
                  <td className="px-5 py-3 text-xs text-slate-500">{n.read ? "read" : "unread"}</td>
                  <td className="px-5 py-3 text-right text-xs text-slate-500"><LocalTime iso={n.createdAt} mode="datetime" /></td>
                </tr>
              ))}
              {feed.items.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-500">No alerts match those filters.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {pages > 1 ? (
          <div className="flex items-center justify-between border-t border-hairline px-5 py-3 text-sm">
            <span className="text-slate-500">Page {page} of {pages} · {feed.total} total</span>
            <div className="flex gap-2">
              <button className={btnGhost} disabled={page <= 1 || busy} onClick={() => { const p = page - 1; setPage(p); load(p, { category, priority, q }); }}>Previous</button>
              <button className={btnGhost} disabled={page >= pages || busy} onClick={() => { const p = page + 1; setPage(p); load(p, { category, priority, q }); }}>Next</button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
