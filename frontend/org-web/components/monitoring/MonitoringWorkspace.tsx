"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, AppWindow, Clock, Gauge, Globe, HeartPulse, Target, Users } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { LocalTime } from "@/components/ui/LocalTime";
import { EmployeeSelect } from "./EmployeeSelect";
import type { AppUsage, MonitoringSession, MonitoringSummary, PresenceRow, TimelineSegment, WebsiteUsage } from "@/lib/api";

type Tab = "overview" | "presence" | "apps" | "websites" | "sessions" | "timeline";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "presence", label: "Presence" },
  { key: "apps", label: "Applications" },
  { key: "websites", label: "Websites" },
  { key: "sessions", label: "Work Sessions" },
  { key: "timeline", label: "Timeline" },
];

const inputCls = "rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm text-slate-900 focus:border-brand focus:outline-none";
const CAT: Record<string, string> = { PRODUCTIVE: "bg-emerald-50 text-emerald-700 ring-emerald-200", DISTRACTING: "bg-rose-50 text-rose-700 ring-rose-200", NEUTRAL: "bg-slate-100 text-slate-600 ring-slate-200" };
function Cat({ c }: { c: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${CAT[c] ?? CAT.NEUTRAL}`}>{c.toLowerCase()}</span>;
}
const PRESENCE_DOT: Record<string, string> = { online: "bg-emerald-500", idle: "bg-amber-500", break: "bg-sky-500", offline: "bg-slate-300" };

export function MonitoringWorkspace({ employees, today }: { employees: { id: string; name: string }[]; today: string }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [day, setDay] = useState(today);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [presence, setPresence] = useState<PresenceRow[]>([]);
  const [apps, setApps] = useState<AppUsage[]>([]);
  const [sites, setSites] = useState<WebsiteUsage[]>([]);
  const [sessions, setSessions] = useState<MonitoringSession[]>([]);
  const [events, setEvents] = useState<TimelineSegment[]>([]);
  const [emp, setEmp] = useState(""); // "" = all employees
  const [empName, setEmpName] = useState("");

  const get = useCallback(async (kind: string, extra = "") => {
    setLoading(true);
    try {
      const r = await fetch(`/api/monitoring/${kind}?day=${day}${extra}`);
      return await r.json();
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, [day]);

  const timelineEmp = emp || employees[0]?.id || "";

  useEffect(() => {
    const q = emp ? `&employeeId=${emp}` : "";
    if (tab === "overview") get("summary", q).then((d) => d && setSummary(d));
    else if (tab === "presence") get("presence", q).then((d) => Array.isArray(d) && setPresence(d));
    else if (tab === "apps") get("apps", q).then((d) => d?.apps && setApps(d.apps));
    else if (tab === "websites") get("websites", q).then((d) => d?.websites && setSites(d.websites));
    else if (tab === "sessions") get("sessions", q).then((d) => d?.sessions && setSessions(d.sessions));
    else if (tab === "timeline" && timelineEmp) get("timeline", `&employeeId=${timelineEmp}`).then((d) => d?.segments && setEvents(d.segments));
  }, [tab, day, emp, timelineEmp, get]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl border border-hairline bg-panel-2 p-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${tab === t.key ? "bg-panel text-slate-900 shadow-sm ring-1 ring-hairline" : "text-slate-500 hover:text-slate-800"}`}>{t.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <EmployeeSelect initial={employees} value={emp} selectedName={empName} onChange={(id, name) => { setEmp(id); setEmpName(name); }} />
          <input type="date" className={inputCls} value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
      </div>
      {emp ? (
        <p className="-mt-3 text-xs text-slate-500">Viewing <span className="font-medium text-slate-700">{empName || "employee"}</span> only — switch to “All employees” for the org view.</p>
      ) : null}

      <div className={loading ? "opacity-50 transition-opacity" : "transition-opacity"}>
        {tab === "overview" ? <Overview s={summary} single={Boolean(emp)} /> : null}
        {tab === "presence" ? <PresenceTable rows={presence} /> : null}
        {tab === "apps" ? <UsageTable kind="app" apps={apps} /> : null}
        {tab === "websites" ? <UsageTable kind="site" sites={sites} /> : null}
        {tab === "sessions" ? <SessionsTable rows={sessions} /> : null}
        {tab === "timeline" ? <Timeline events={events} name={emp ? empName : (employees.find((e) => e.id === timelineEmp)?.name ?? "—")} /> : null}
      </div>
    </div>
  );
}

function Overview({ s, single }: { s: MonitoringSummary | null; single: boolean }) {
  if (!s) return <Card><CardBody className="py-10 text-center text-sm text-slate-500">Loading…</CardBody></Card>;
  const status = s.online > 0 ? "Online" : s.idle > 0 ? "Idle" : "Offline";
  return (
    <div className="space-y-6">
      {single ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          <StatTile label="Productivity" value={`${s.avgProductivity}%`} icon={Gauge} accent="#0d9488" />
          <StatTile label="Focus" value={`${s.avgFocus}%`} icon={Target} accent="#16a34a" />
          <StatTile label="Utilization" value={`${s.utilization}%`} icon={Gauge} accent="#1f883d" />
          <StatTile label="Active hours" value={String(s.activeHours)} icon={HeartPulse} accent="#166534" />
          <StatTile label="Idle hours" value={String(s.idleHours)} icon={Clock} accent="#d97706" />
          <StatTile label="Status" value={status} icon={Activity} accent={status === "Online" ? "#16a34a" : status === "Idle" ? "#d97706" : "#64748b"} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          <StatTile label="Tracked" value={String(s.trackedEmployees)} icon={Users} accent="#1f883d" />
          <StatTile label="Online" value={String(s.online)} icon={Activity} accent="#16a34a" />
          <StatTile label="Idle" value={String(s.idle)} icon={Clock} accent="#d97706" />
          <StatTile label="Avg productivity" value={`${s.avgProductivity}%`} icon={Gauge} accent="#0d9488" />
          <StatTile label="Active hours" value={String(s.activeHours)} icon={HeartPulse} accent="#166534" />
          <StatTile label="Utilization" value={`${s.utilization}%`} icon={Gauge} accent="#1f883d" />
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top applications" subtitle="Time spent today" />
          <TopList rows={s.topApps.map((a) => ({ label: a.appName, category: a.category, hours: a.hours }))} icon={AppWindow} />
        </Card>
        <Card>
          <CardHeader title="Top websites" subtitle="Time spent today" />
          <TopList rows={s.topWebsites.map((w) => ({ label: w.domain, category: w.category, hours: w.hours }))} icon={Globe} />
        </Card>
      </div>
    </div>
  );
}

function TopList({ rows, icon: Icon }: { rows: { label: string; category: string; hours: number }[]; icon: typeof AppWindow }) {
  if (rows.length === 0) return <CardBody className="py-8 text-center text-sm text-slate-500">No activity recorded.</CardBody>;
  return (
    <ul className="divide-y divide-hairline/60">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
          <span className="flex items-center gap-2.5"><span className="grid size-8 place-items-center rounded-lg bg-panel-2 text-slate-500 ring-1 ring-inset ring-hairline"><Icon className="size-4" /></span><span className="font-medium text-slate-900">{r.label}</span><Cat c={r.category} /></span>
          <span className="tabular-nums text-slate-600">{r.hours}h</span>
        </li>
      ))}
    </ul>
  );
}

function PresenceTable({ rows }: { rows: PresenceRow[] }) {
  return (
    <Card>
      <CardHeader title="Presence" subtitle="Latest activity per employee" />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="border-b border-hairline text-xs text-slate-500"><th className="px-5 py-3 text-left font-medium">Employee</th><th className="px-5 py-3 text-left font-medium">Status</th><th className="px-5 py-3 text-left font-medium">Last activity</th><th className="px-5 py-3 text-right font-medium">Last seen</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employeeId} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                <td className="px-5 py-3 font-medium text-slate-900">{r.name}</td>
                <td className="px-5 py-3"><span className="inline-flex items-center gap-1.5"><span className={`size-2 rounded-full ${PRESENCE_DOT[r.status] ?? "bg-slate-300"}`} />{r.status}</span></td>
                <td className="px-5 py-3 text-slate-600">{r.lastActivity}{r.lastTitle ? ` · ${r.lastTitle}` : ""}</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-500"><LocalTime iso={r.lastSeen} /></td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={4} className="px-5 py-8 text-center text-sm text-slate-500">No activity yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function UsageTable({ kind, apps, sites }: { kind: "app" | "site"; apps?: AppUsage[]; sites?: WebsiteUsage[] }) {
  const rows = kind === "app" ? (apps ?? []).map((a) => ({ key: a.appName, label: a.appName, category: a.category, hours: a.hours, extra: "" })) : (sites ?? []).map((w) => ({ key: w.domain, label: w.domain, category: w.category, hours: w.hours, extra: `${w.visits} visits` }));
  return (
    <Card>
      <CardHeader title={kind === "app" ? "Application usage" : "Website usage"} subtitle="Aggregated across employees" />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead><tr className="border-b border-hairline text-xs text-slate-500"><th className="px-5 py-3 text-left font-medium">{kind === "app" ? "Application" : "Website"}</th><th className="px-5 py-3 text-left font-medium">Category</th>{kind === "site" ? <th className="px-5 py-3 text-right font-medium">Visits</th> : null}<th className="px-5 py-3 text-right font-medium">Hours</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                <td className="px-5 py-3 font-medium text-slate-900">{r.label}</td>
                <td className="px-5 py-3"><Cat c={r.category} /></td>
                {kind === "site" ? <td className="px-5 py-3 text-right tabular-nums text-slate-500">{r.extra.split(" ")[0]}</td> : null}
                <td className="px-5 py-3 text-right tabular-nums text-slate-600">{r.hours}h</td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={kind === "site" ? 4 : 3} className="px-5 py-8 text-center text-sm text-slate-500">No usage recorded.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SessionsTable({ rows }: { rows: MonitoringSession[] }) {
  return (
    <Card>
      <CardHeader title="Work sessions" subtitle="Login → logout, active & idle time" />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead><tr className="border-b border-hairline text-xs text-slate-500"><th className="px-5 py-3 text-left font-medium">Employee</th><th className="px-5 py-3 text-left font-medium">Status</th><th className="px-5 py-3 text-right font-medium">Started</th><th className="px-5 py-3 text-right font-medium">Ended</th><th className="px-5 py-3 text-right font-medium">Active</th><th className="px-5 py-3 text-right font-medium">Idle</th><th className="px-5 py-3 text-right font-medium">Duration</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                <td className="px-5 py-3 font-medium text-slate-900">{r.name}</td>
                <td className="px-5 py-3">
                  {r.open ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"><span className="size-1.5 rounded-full bg-emerald-500" />Active</span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-inset ring-slate-200">Ended</span>
                  )}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-600"><LocalTime iso={r.startedAt} /></td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-600">{r.open ? "—" : <LocalTime iso={r.endedAt} />}</td>
                <td className="px-5 py-3 text-right tabular-nums text-emerald-700">{r.activeHours}h</td>
                <td className="px-5 py-3 text-right tabular-nums text-amber-700">{r.idleHours}h</td>
                <td className="px-5 py-3 text-right tabular-nums text-slate-600">{r.durationHours}h</td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-500">No sessions recorded.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const TYPE_TONE: Record<string, string> = { app: "text-slate-700", website: "text-sky-700", idle: "text-amber-700", break: "text-sky-700", session: "text-emerald-700", screenshot: "text-violet-700", focus: "text-emerald-700", context_switch: "text-slate-400" };
function Timeline({ events, name }: { events: TimelineSegment[]; name: string }) {
  return (
    <Card>
      <CardHeader title="Activity timeline" subtitle={`Blocks of continuous activity — ${name}`} />
      <ul className="divide-y divide-hairline/60">
        {events.map((e) => {
          const marker = e.seconds === 0; // session markers etc. have no duration
          const mins = Math.max(1, Math.round(e.seconds / 60));
          return (
            <li key={e.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <span className="w-28 shrink-0 tabular-nums text-xs text-slate-500">{marker ? <LocalTime iso={e.startAt} /> : <><LocalTime iso={e.startAt} />–<LocalTime iso={e.endAt} /></>}</span>
              <span className={`w-20 shrink-0 text-xs font-medium ${TYPE_TONE[e.type] ?? "text-slate-500"}`}>{e.type.replace("_", " ")}</span>
              <span className="min-w-0 flex-1 truncate text-slate-700">{e.title ?? e.detail ?? "—"}</span>
              {!marker ? <span className="shrink-0 tabular-nums text-xs text-slate-400">{mins}m</span> : null}
              {e.category ? <Cat c={e.category} /> : null}
            </li>
          );
        })}
        {events.length === 0 ? <li className="px-5 py-8 text-center text-sm text-slate-500">No activity for this day.</li> : null}
      </ul>
    </Card>
  );
}
