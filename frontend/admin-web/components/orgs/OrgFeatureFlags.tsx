"use client";

import { useState, useTransition } from "react";
import { Ban, Check, Globe, RotateCcw, ShieldOff } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";

export interface OrgFeature {
  feature: string;
  globalEnabled: boolean;
  /** null = no override; this org inherits the global flag. */
  override: boolean | null;
  enabled: boolean;
  source: "global" | "org" | "kill_switch";
  reason: string | null;
  updatedAt: string | null;
}

/** Feature keys are camelCase; show them the way a human would say them. */
const LABEL: Record<string, string> = {
  customerSuccess: "Customer Success",
  platformHealth: "Platform Health",
  activityFeed: "Activity Feed",
  timeTracking: "Time Tracking",
  attendance: "Attendance",
  projects: "Projects & Teams",
  screenshots: "Screenshots",
  aiInsights: "AI Insights",
  billing: "Billing",
};

const label = (k: string) => LABEL[k] ?? k;

export function OrgFeatureFlags({ orgId, orgName, initial }: { orgId: string; orgName: string; initial: OrgFeature[] }) {
  const [features, setFeatures] = useState(initial);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (feature: string, enabled: boolean | null) =>
    start(async () => {
      setError(null);
      setBusy(feature);
      const res = await fetch(`/api/admin/organizations/${orgId}/features`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature, enabled }),
      });
      setBusy(null);
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(d.error?.message ?? "Could not change this feature.");
        return;
      }
      const d = (await res.json()) as { features: OrgFeature[] };
      // The PATCH already returns the full, updated flag set, so we render from
      // that. A router.refresh() here would re-fetch the whole org page on every
      // toggle for data we already hold — pure redundant round-trips.
      setFeatures(d.features);
    });

  const overrides = features.filter((f) => f.override !== null).length;

  return (
    <Card>
      <CardHeader
        title="Feature access"
        subtitle={
          overrides === 0
            ? `${orgName} inherits every platform default`
            : `${overrides} feature${overrides === 1 ? "" : "s"} set specifically for ${orgName}`
        }
      />
      <CardBody className="space-y-3">
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}

        <p className="text-xs text-slate-500">
          Turning a feature off here affects <span className="font-medium text-slate-700">only {orgName}</span>. If a feature is
          switched off platform-wide in SaaS Configuration, it stays off here and cannot be re-enabled for a single organization.
        </p>

        <ul className="divide-y divide-hairline/60 rounded-xl border border-hairline/70">
          {features.map((f) => {
            const killed = f.source === "kill_switch";
            const isBusy = busy === f.feature;
            return (
              <li key={f.feature} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    {label(f.feature)}
                    {killed ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
                        <ShieldOff className="size-3" /> Off platform-wide
                      </span>
                    ) : f.source === "org" ? (
                      <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand ring-1 ring-inset ring-brand/20">
                        Set for this org
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                        <Globe className="size-3" /> Platform default
                      </span>
                    )}
                  </span>
                  {f.reason ? <span className="mt-0.5 block text-xs text-slate-400">{f.reason}</span> : null}
                </span>

                <span className="flex shrink-0 items-center gap-2">
                  {f.source === "org" && !killed ? (
                    <button
                      onClick={() => set(f.feature, null)}
                      disabled={pending}
                      title="Follow the platform default again"
                      className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-panel px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <RotateCcw className="size-3" /> Reset
                    </button>
                  ) : null}

                  <span className={`flex gap-1 rounded-lg border border-hairline bg-panel-2 p-0.5 ${killed ? "opacity-50" : ""}`}>
                    {[
                      { on: true, t: "On", Icon: Check },
                      { on: false, t: "Off", Icon: Ban },
                    ].map((o) => (
                      <button
                        key={o.t}
                        onClick={() => set(f.feature, o.on)}
                        disabled={pending || killed}
                        title={killed ? "This feature is off platform-wide" : undefined}
                        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                          f.enabled === o.on && !killed
                            ? o.on
                              ? "bg-panel text-emerald-700 shadow-sm ring-1 ring-hairline"
                              : "bg-panel text-rose-600 shadow-sm ring-1 ring-hairline"
                            : "text-slate-400 hover:text-slate-700"
                        }`}
                      >
                        <o.Icon className="size-3" /> {o.t}
                      </button>
                    ))}
                  </span>
                  {isBusy ? <span className="text-xs text-slate-400">saving…</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}
