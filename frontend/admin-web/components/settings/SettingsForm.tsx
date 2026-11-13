"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import type { ApiPlatformSettings } from "@/lib/admin-api";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";

function humanize(key: string) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? "bg-brand" : "bg-slate-300"}`}
    >
      <span className={`inline-block size-4 transform rounded-full bg-white transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}

function SaveButton({ section, build }: { section: string; build: () => Record<string, unknown> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    start(async () => {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [section]: build() }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "Could not save.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh(); // re-render layout banners / nav from the new settings
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-strong disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {saved ? (
        <span className="inline-flex items-center gap-1 text-sm text-emerald-600">
          <Check className="size-4" /> Saved
        </span>
      ) : null}
      {error ? <span className="text-sm text-rose-600">{error}</span> : null}
    </div>
  );
}

export function SettingsForm({ initial }: { initial: ApiPlatformSettings }) {
  // Platform branding
  const [platformName, setPlatformName] = useState(initial.branding.platformName);
  const [primaryColor, setPrimaryColor] = useState(initial.branding.primaryColor);
  const [supportEmail, setSupportEmail] = useState(initial.branding.supportEmail);
  const [logoUrl, setLogoUrl] = useState(initial.branding.logoUrl);

  // Global notification
  const [notifEnabled, setNotifEnabled] = useState(initial.notification.enabled);
  const [notifMessage, setNotifMessage] = useState(initial.notification.message);
  const [notifLevel, setNotifLevel] = useState(initial.notification.level);

  // Feature flags
  const [flags, setFlags] = useState<Record<string, boolean>>(initial.featureFlags);

  // Maintenance
  const [maintEnabled, setMaintEnabled] = useState(initial.maintenance.enabled);
  const [maintMessage, setMaintMessage] = useState(initial.maintenance.message);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Platform Branding */}
      <Card>
        <CardHeader title="Platform branding" subtitle="Name, colour and support contact shown across the product" />
        <CardBody className="space-y-4">
          <div>
            <label className={label}>Platform name</label>
            <input className={input} value={platformName} onChange={(e) => setPlatformName(e.target.value)} maxLength={60} />
          </div>
          <div className="flex items-end gap-3">
            <div>
              <label className={label}>Primary colour</label>
              <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-10 w-16 cursor-pointer rounded-lg border border-hairline bg-panel" />
            </div>
            <span className="pb-2.5 font-mono text-xs text-slate-500">{primaryColor}</span>
          </div>
          <div>
            <label className={label}>Support email</label>
            <input className={input} value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} type="email" />
          </div>
          <div>
            <label className={label}>Logo URL</label>
            <input className={input} value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" />
          </div>
          <SaveButton section="branding" build={() => ({ platformName, primaryColor, supportEmail, logoUrl })} />
        </CardBody>
      </Card>

      {/* Global Notifications */}
      <Card>
        <CardHeader title="Global notification" subtitle="A platform-wide banner shown to every admin" />
        <CardBody className="space-y-4">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-panel/60 px-3 py-2.5">
            <span className="text-sm font-medium text-slate-700">Show banner</span>
            <Toggle checked={notifEnabled} onChange={setNotifEnabled} />
          </label>
          <div>
            <label className={label}>Message</label>
            <textarea className={input} rows={2} value={notifMessage} onChange={(e) => setNotifMessage(e.target.value)} maxLength={500} />
          </div>
          <div>
            <label className={label}>Level</label>
            <select className={input} value={notifLevel} onChange={(e) => setNotifLevel(e.target.value as typeof notifLevel)}>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <SaveButton section="notification" build={() => ({ enabled: notifEnabled, message: notifMessage, level: notifLevel })} />
        </CardBody>
      </Card>

      {/* Feature Flags */}
      <Card>
        <CardHeader title="Feature flags" subtitle="Toggle platform modules on or off" />
        <CardBody className="space-y-3">
          {Object.keys(flags).map((key) => (
            <label key={key} className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-panel/60 px-3 py-2.5">
              <span className="text-sm font-medium text-slate-700">{humanize(key)}</span>
              <Toggle checked={flags[key]} onChange={(v) => setFlags((f) => ({ ...f, [key]: v }))} />
            </label>
          ))}
          <SaveButton section="featureFlags" build={() => flags} />
        </CardBody>
      </Card>

      {/* Maintenance Mode */}
      <Card>
        <CardHeader title="Maintenance mode" subtitle="Display a maintenance banner across the platform" />
        <CardBody className="space-y-4">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-panel/60 px-3 py-2.5">
            <span className="text-sm font-medium text-slate-700">Enable maintenance mode</span>
            <Toggle checked={maintEnabled} onChange={setMaintEnabled} />
          </label>
          <div>
            <label className={label}>Message</label>
            <textarea className={input} rows={2} value={maintMessage} onChange={(e) => setMaintMessage(e.target.value)} maxLength={500} />
          </div>
          {maintEnabled ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-200">
              A maintenance banner will show on every page until this is turned off.
            </p>
          ) : null}
          <SaveButton section="maintenance" build={() => ({ enabled: maintEnabled, message: maintMessage })} />
        </CardBody>
      </Card>
    </div>
  );
}
