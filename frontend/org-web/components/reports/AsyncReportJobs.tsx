"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileClock, Download, Loader2, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { LocalTime } from "@/components/ui/LocalTime";

interface Job {
  id: string; kind: string; format: string; status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  fileName: string | null; rowCount: number | null; error: string | null;
  createdAt: string; completedAt: string | null;
}

const STATUS: Record<Job["status"], { label: string; cls: string }> = {
  PENDING: { label: "Queued", cls: "text-slate-500" },
  RUNNING: { label: "Generating…", cls: "text-amber-600" },
  DONE: { label: "Ready", cls: "text-emerald-600" },
  FAILED: { label: "Failed", cls: "text-rose-600" },
};

/**
 * Large / async reports. Queue an attendance report to be built off the request
 * path; it appears here and becomes downloadable when the worker finishes. Polls
 * while any job is still running. Good for org-wide, long-range exports that would
 * otherwise time out a normal download.
 */
export function AsyncReportJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState("org");
  const [format, setFormat] = useState<"csv" | "xlsx">("xlsx");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    fetch(`/api/reports/jobs`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setJobs(Array.isArray(d) ? d : []))
      .catch(() => undefined);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll every 4s while a job is still pending/running.
  useEffect(() => {
    const active = jobs.some((j) => j.status === "PENDING" || j.status === "RUNNING");
    if (active) { timer.current = setTimeout(load, 4000); }
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [jobs, load]);

  async function queue() {
    setBusy(true);
    try {
      const res = await fetch(`/api/reports/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "attendance", format, params: { scope, period: "month" } }),
      });
      if (res.ok) load();
    } finally { setBusy(false); }
  }

  async function download(id: string) {
    const r = await fetch(`/api/reports/jobs/${id}/download`, { cache: "no-store" });
    if (!r.ok) return;
    const { url } = (await r.json()) as { url: string };
    if (url) window.open(url, "_blank");
  }

  const sel = "rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-sm text-slate-700 focus:border-brand focus:outline-none";
  return (
    <Card>
      <CardHeader
        title="Large reports (async)"
        subtitle="Queue an org-wide report — it builds in the background and downloads when ready"
        action={
          <div className="flex items-center gap-2">
            <select value={scope} onChange={(e) => setScope(e.target.value)} className={sel}>
              <option value="org">Whole org</option>
            </select>
            <select value={format} onChange={(e) => setFormat(e.target.value as "csv" | "xlsx")} className={sel}>
              <option value="xlsx">Excel</option>
              <option value="csv">CSV</option>
            </select>
            <button onClick={queue} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50">
              <FileClock className="size-4" /> Generate
            </button>
            <button onClick={load} title="Refresh" className="rounded-lg border border-hairline p-1.5 text-slate-500 hover:bg-slate-50"><RefreshCw className="size-4" /></button>
          </div>
        }
      />
      <div className="p-4">
        {jobs.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No report jobs yet. Queue one above.</p>
        ) : (
          <ul className="divide-y divide-hairline/60">
            {jobs.map((j) => {
              const st = STATUS[j.status];
              return (
                <li key={j.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="inline-flex items-center gap-2 text-sm font-medium capitalize text-slate-800">
                    {j.status === "DONE" ? <CheckCircle2 className="size-4 text-emerald-600" /> : j.status === "FAILED" ? <XCircle className="size-4 text-rose-600" /> : <Loader2 className={`size-4 ${j.status === "RUNNING" ? "animate-spin text-amber-600" : "text-slate-400"}`} />}
                    {j.kind} report
                  </span>
                  <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[11px] uppercase text-slate-500">{j.format}</span>
                  <span className={`text-xs font-medium ${st.cls}`}>{st.label}</span>
                  {j.status === "DONE" && j.rowCount != null ? <span className="text-xs text-slate-400">{j.rowCount} rows</span> : null}
                  {j.error ? <span className="text-xs text-rose-500">{j.error}</span> : null}
                  <span className="text-[11px] text-slate-400"><LocalTime iso={j.createdAt} /></span>
                  {j.status === "DONE" ? (
                    <button onClick={() => download(j.id)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"><Download className="size-3.5" /> Download</button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
