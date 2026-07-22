"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Coffee, Loader2, LogIn, LogOut, Play } from "lucide-react";
import { LocalTime } from "@/components/ui/LocalTime";
import { cn } from "@/lib/cn";

export type AttendanceAction = "CHECK_IN" | "CHECK_OUT" | "BREAK_START" | "BREAK_END";

export interface AttendanceStatus {
  tracksAttendance: boolean;
  state: string;
  /** The only list the UI renders from — the server decides what's valid. */
  availableActions: AttendanceAction[];
  checkedIn: boolean;
  checkedOut: boolean;
  onBreak: boolean;
  checkInAt: string | null;
  checkOutAt: string | null;
  breakMinutes: number;
  unpaidBreakMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
  openBreakStartedAt: string | null;
  openSessionStartedAt: string | null;
  workMinutes: number;
  sessionCount: number;
  breakCount: number;
  source: string | null;
  checkOutSource: string | null;
  workLocation: string | null;
  policy?: { allowMultipleSessions: boolean; allowReEntry: boolean; maxSessionsPerDay: number; requireLocation: boolean; allowedLocations: string[]; workModel: string };
  sessions?: { id: string; sequence: number; startedAt: string; endedAt: string | null; minutes: number; startSource: string; endSource: string | null; autoClosed: boolean }[];
  breaks?: { id: string; startedAt: string; endedAt: string | null; minutes: number; kind: string; paid: boolean }[];
}

const STATE_LABEL: Record<string, string> = {
  NOT_CHECKED_IN: "Not checked in",
  WORKING: "Working",
  ON_BREAK: "On break",
  CHECKED_OUT: "Checked out",
  COMPLETED: "Attendance completed",
  ABSENT: "Absent",
  ON_LEAVE: "On leave",
  HOLIDAY: "Holiday",
  WEEKEND: "Weekend",
};
const STATE_TINT: Record<string, string> = {
  WORKING: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
  ON_BREAK: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  CHECKED_OUT: "bg-sky-500/10 text-sky-700 ring-sky-600/20",
  COMPLETED: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
  NOT_CHECKED_IN: "bg-slate-500/10 text-slate-500 ring-slate-500/20",
};
const BREAK_KINDS = [
  { key: "LUNCH", label: "Lunch" },
  { key: "TEA", label: "Tea / coffee" },
  { key: "PERSONAL", label: "Personal" },
  { key: "MEETING", label: "Meeting" },
  { key: "OTHER", label: "Other" },
];
const hhmm = (mins: number) => `${Math.floor(mins / 60)}h ${mins % 60}m`;

const SOURCE_LABEL: Record<string, string> = { agent: "desktop agent", web: "web" };

/**
 * Check in / out and break controls.
 *
 * State is owned by the server, not this component, so an action taken in the
 * desktop agent shows up here too. The agent's writes publish a realtime event
 * on the user's channel; the notifications SSE stream is already open for every
 * signed-in user, so we listen there and re-read status — no extra socket, and
 * no polling loop that would keep firing when nothing is happening.
 */
export function CheckInOut({ initial }: { initial: AttendanceStatus | null }) {
  const router = useRouter();
  const [status, setStatus] = useState<AttendanceStatus | null>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [breakKind, setBreakKind] = useState("LUNCH");

  const load = useCallback(async () => {
    const res = await fetch("/api/attendance/status", { cache: "no-store" });
    if (res.ok) setStatus((await res.json()) as AttendanceStatus);
  }, []);

  // Live sync: the SSE stream carries attendance events alongside notifications.
  useEffect(() => {
    const es = new EventSource("/api/notifications/stream");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { type?: string };
        if (data.type === "attendance") {
          void load();
          router.refresh(); // keep the surrounding server-rendered cards honest
        }
      } catch {
        // ignore keep-alive pings and any non-JSON frames
      }
    };
    return () => es.close();
  }, [load, router]);

  async function act(path: string, key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/attendance/${path}`, { method: "POST" });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "That didn't work.");
      }
      await load();
    } finally {
      router.refresh();
      setBusy(null);
    }
  }

  // Owners run the org rather than working shifts in it — no attendance for them.
  if (status && !status.tracksAttendance) {
    return (
      <p className="text-sm text-slate-500">
        Attendance is tracked for staff. Owner accounts aren&apos;t rostered, so there&apos;s nothing to check in to.
      </p>
    );
  }

  // The server tells us which actions are valid; we never infer them here, so
  // the UI can't offer something the state machine would reject.
  const actions = status?.availableActions ?? [];
  const allow = (a: AttendanceAction) => actions.includes(a);
  const state = status?.state ?? "NOT_CHECKED_IN";
  const isSecondSession = (status?.sessionCount ?? 0) > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", STATE_TINT[state] ?? STATE_TINT.NOT_CHECKED_IN)}>
          {STATE_LABEL[state] ?? state}
        </span>
        {status?.workLocation ? <span className="text-xs text-slate-500">{status.workLocation.replace("_", " ").toLowerCase()}</span> : null}
        {(status?.sessionCount ?? 0) > 1 ? <span className="text-xs text-slate-500">Session {status!.sessionCount}</span> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {allow("CHECK_IN") ? (
          <button
            type="button"
            onClick={() => act("check-in", "in")}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "in" ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
            {isSecondSession ? "Check in again" : "Check in"}
          </button>
        ) : null}

        {allow("BREAK_START") ? (
          <div className="flex items-center gap-1.5">
            <select
              value={breakKind}
              onChange={(e) => setBreakKind(e.target.value)}
              className="rounded-xl border border-hairline bg-panel px-2.5 py-2.5 text-sm text-slate-700 focus:border-brand focus:outline-none"
            >
              {BREAK_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
            <button
              type="button"
              onClick={() => act(`break/start?kind=${breakKind}`, "break")}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-panel px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "break" ? <Loader2 className="size-4 animate-spin" /> : <Coffee className="size-4" />}
              Take a break
            </button>
          </div>
        ) : null}

        {allow("BREAK_END") ? (
          <button
            type="button"
            onClick={() => act("break/end", "break")}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "break" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            End break
          </button>
        ) : null}

        {allow("CHECK_OUT") ? (
          <button
            type="button"
            onClick={() => act("check-out", "out")}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-panel px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "out" ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
            Check out
          </button>
        ) : null}

        {actions.length === 0 && status ? (
          <p className="text-sm text-slate-500">
            {state === "COMPLETED" ? "Attendance completed for today." : `Nothing to do — today is a ${STATE_LABEL[state]?.toLowerCase() ?? "non-working day"}.`}
          </p>
        ) : null}
      </div>

      {status ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          {status.onBreak ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-amber-600">
              <span className="size-2 animate-pulse rounded-full bg-amber-500" />
              On break since <LocalTime iso={status.openBreakStartedAt} />
            </span>
          ) : null}
          {status.checkInAt ? (
            <span>
              In <LocalTime iso={status.checkInAt} />
              {status.source ? ` · via ${SOURCE_LABEL[status.source] ?? status.source}` : ""}
            </span>
          ) : null}
          {status.checkOutAt ? (
            <span>
              Out <LocalTime iso={status.checkOutAt} />
              {status.checkOutSource ? ` · via ${SOURCE_LABEL[status.checkOutSource] ?? status.checkOutSource}` : ""}
            </span>
          ) : null}
          {status.workMinutes > 0 ? <span>Worked {hhmm(status.workMinutes)}</span> : null}
          {status.breakMinutes > 0 ? <span>Breaks {status.breakMinutes} min</span> : null}
          {status.overtimeMinutes > 0 ? <span className="font-medium text-emerald-600">OT {hhmm(status.overtimeMinutes)}</span> : null}
          {status.lateMinutes > 0 ? <span className="font-medium text-amber-600">Late {status.lateMinutes} min</span> : null}
        </div>
      ) : null}

      {/* Multiple sessions: show the day's timeline so re-entry is legible. */}
      {(status?.sessions?.length ?? 0) > 1 ? (
        <ul className="flex flex-col gap-1 border-t border-hairline pt-2 text-xs text-slate-500">
          {status!.sessions!.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-slate-400">Session {s.sequence}</span>
              <LocalTime iso={s.startedAt} />
              <span className="text-slate-300">→</span>
              {s.endedAt ? <LocalTime iso={s.endedAt} /> : <span className="font-medium text-emerald-600">now</span>}
              <span className="text-slate-400">· {hhmm(s.minutes)}</span>
              {s.autoClosed ? <span className="text-amber-600">auto-closed</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
