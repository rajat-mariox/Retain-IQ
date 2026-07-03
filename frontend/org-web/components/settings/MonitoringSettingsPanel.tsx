"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import type { MonitoringPolicy } from "@/lib/api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";
const INTERVALS = [1, 2, 5, 10, 15, 30, 60];

export function MonitoringSettingsPanel({ initial }: { initial: MonitoringPolicy }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(initial.screenshotsEnabled);
  const [intervalMin, setIntervalMin] = useState(Math.round(initial.screenshotIntervalSeconds / 60));
  const [quality, setQuality] = useState(initial.screenshotQuality);
  const [width, setWidth] = useState(initial.screenshotMaxWidth);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function save() {
    setMsg(null);
    setError(null);
    start(async () => {
      const res = await fetch("/api/monitoring/policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screenshotsEnabled: enabled, screenshotIntervalSeconds: Math.max(60, intervalMin * 60), screenshotQuality: quality, screenshotMaxWidth: width }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "Could not save.");
        return;
      }
      setMsg("Saved — agents apply the new policy within a few minutes.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader title="Monitoring & screenshots" subtitle="Agent capture policy — applies to all desktop agents in your org" />
      <CardBody className="space-y-4">
        <label className="flex items-center gap-2.5 text-sm text-slate-700">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4 rounded border-hairline text-brand focus:ring-brand" />
          <span className="inline-flex items-center gap-1.5"><Camera className="size-4 text-slate-500" /> Capture screenshots</span>
        </label>

        <div className={`grid grid-cols-1 gap-4 sm:grid-cols-3 ${enabled ? "" : "pointer-events-none opacity-50"}`}>
          <div>
            <label className={label}>Interval</label>
            <select className={input} value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value))}>
              {INTERVALS.map((m) => <option key={m} value={m}>{m === 60 ? "1 hour" : `${m} min`}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Quality (10–100)</label>
            <input type="number" min={10} max={100} className={input} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
          </div>
          <div>
            <label className={label}>Max width (px)</label>
            <select className={input} value={width} onChange={(e) => setWidth(Number(e.target.value))}>
              {[960, 1280, 1600, 1920].map((w) => <option key={w} value={w}>{w}px</option>)}
            </select>
          </div>
        </div>

        <p className="text-xs text-slate-500">Screenshots are captured while an agent is tracking (including idle), downscaled and compressed, and count against your storage quota. Changing the interval takes effect on each agent at its next policy check (≤ 5 min).</p>

        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        {msg ? <p className="text-sm text-emerald-600">{msg}</p> : null}
        <div className="flex justify-end">
          <button onClick={save} disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{pending ? "Saving…" : "Save policy"}</button>
        </div>
      </CardBody>
    </Card>
  );
}
