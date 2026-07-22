"use client";

import { useEffect, useState } from "react";
import { Bell, Mail, MonitorSmartphone, Moon } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import type { NotificationPreference, NotificationPrefsPayload, NotificationSettings as Settings } from "@/lib/api";

const CATEGORY_LABEL: Record<string, { label: string; hint: string }> = {
  ATTENDANCE: { label: "Attendance", hint: "Leave decisions, missed check-ins, late arrivals" },
  PROJECT: { label: "Projects & Tasks", hint: "Task assignments, deadlines, timesheets, milestones" },
  PRODUCTIVITY: { label: "Productivity", hint: "Productivity drops, focus and activity alerts" },
  AI: { label: "AI Recommendations", hint: "Workload balancing, burnout prevention, insights" },
  SYSTEM: { label: "System", hint: "Account, org and platform announcements" },
};

const input = "rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1.5 block text-sm font-medium text-slate-700";
const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60";

// Browser push needs an explicit permission grant; we surface its state here.
type PushState = "unsupported" | "default" | "granted" | "denied";

export function NotificationSettings({ initial }: { initial: NotificationPrefsPayload }) {
  const [prefs, setPrefs] = useState<NotificationPreference[]>(initial.preferences);
  const [settings, setSettings] = useState<Settings>(initial.settings);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [push, setPush] = useState<PushState>("default");

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
      setPush("unsupported");
      return;
    }
    setPush(Notification.permission as PushState);
    // Detect the viewer's timezone once so quiet hours mean their local clock.
    if (settings.timezone === "UTC") {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) setSettings((s) => ({ ...s, timezone: tz }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(category: string, channel: "inApp" | "email" | "push") {
    setPrefs((prev) => prev.map((p) => (p.category === category ? { ...p, [channel]: !p[channel] } : p)));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/notifications/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferences: prefs, settings }),
    });
    setSaving(false);
    setMsg(res.ok ? "Preferences saved." : "Could not save preferences.");
  }

  async function enablePush() {
    if (push === "unsupported") return;
    const permission = await Notification.requestPermission();
    setPush(permission as PushState);
    if (permission !== "granted") return;
    // Register the service worker and subscribe (VAPID key served by the BFF).
    const keyRes = await fetch("/api/notifications/push/public-key");
    if (!keyRes.ok) { setMsg("Push is not configured on this server."); return; }
    const { publicKey } = (await keyRes.json()) as { publicKey: string };
    if (!publicKey) { setMsg("Push is not configured on this server."); return; }
    const reg = await navigator.serviceWorker.register("/sw.js");
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    await fetch("/api/notifications/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth, userAgent: navigator.userAgent }),
    });
    setMsg("Push notifications enabled on this device.");
  }

  return (
    <div className="space-y-5">
      {/* §11 category × channel matrix */}
      <Card>
        <CardHeader title="Notification categories" subtitle="Choose how you want to be notified for each kind of alert" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-xs text-slate-500">
                <th className="px-5 py-3 text-left font-medium">Category</th>
                <th className="px-5 py-3 text-center font-medium"><span className="inline-flex items-center gap-1.5"><Bell className="size-3.5" /> In-app</span></th>
                <th className="px-5 py-3 text-center font-medium"><span className="inline-flex items-center gap-1.5"><Mail className="size-3.5" /> Email</span></th>
                <th className="px-5 py-3 text-center font-medium"><span className="inline-flex items-center gap-1.5"><MonitorSmartphone className="size-3.5" /> Push</span></th>
              </tr>
            </thead>
            <tbody>
              {prefs.map((p) => {
                const meta = CATEGORY_LABEL[p.category] ?? { label: p.category, hint: "" };
                return (
                  <tr key={p.category} className="border-b border-hairline/60 last:border-0">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">{meta.label}</p>
                      <p className="text-xs text-slate-500">{meta.hint}</p>
                    </td>
                    {(["inApp", "email", "push"] as const).map((ch) => (
                      <td key={ch} className="px-5 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={p[ch]}
                          onChange={() => toggle(p.category, ch)}
                          className="size-4 rounded border-hairline text-brand focus:ring-brand"
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* §7 email digest */}
        <Card>
          <CardHeader title="Email summaries" subtitle="Get a rolled-up digest instead of every single email" />
          <CardBody className="space-y-3">
            <div>
              <label className={label}>Digest frequency</label>
              <select className={cn(input, "w-full")} value={settings.digest} onChange={(e) => setSettings({ ...settings, digest: e.target.value })}>
                <option value="OFF">Off — send emails as they happen</option>
                <option value="DAILY">Daily summary</option>
                <option value="WEEKLY">Weekly summary</option>
              </select>
            </div>
            {settings.digest !== "OFF" ? (
              <div>
                <label className={label}>Send at</label>
                <select className={cn(input, "w-full")} value={settings.digestHour} onChange={(e) => setSettings({ ...settings, digestHour: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                </select>
              </div>
            ) : null}
          </CardBody>
        </Card>

        {/* §8 push + quiet hours */}
        <Card>
          <CardHeader title="Push & quiet hours" subtitle="Browser push and when to hold non-urgent delivery" />
          <CardBody className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-hairline bg-panel-2 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-slate-800">Browser push</p>
                <p className="text-xs text-slate-500">
                  {push === "granted" ? "Enabled on this device" : push === "denied" ? "Blocked in browser settings" : push === "unsupported" ? "Not supported by this browser" : "Not enabled yet"}
                </p>
              </div>
              <button type="button" onClick={enablePush} disabled={push === "granted" || push === "denied" || push === "unsupported"} className={cn(btnPrimary, "px-3 py-1.5 text-xs")}>
                {push === "granted" ? "Enabled" : "Enable"}
              </button>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={settings.quietHoursEnabled} onChange={(e) => setSettings({ ...settings, quietHoursEnabled: e.target.checked })} className="size-4 rounded border-hairline text-brand focus:ring-brand" />
              <Moon className="size-3.5 text-slate-400" /> Enable quiet hours
            </label>
            {settings.quietHoursEnabled ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={label}>From</label>
                    <select className={cn(input, "w-full")} value={settings.quietStart} onChange={(e) => setSettings({ ...settings, quietStart: Number(e.target.value) })}>
                      {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={label}>To</label>
                    <select className={cn(input, "w-full")} value={settings.quietEnd} onChange={(e) => setSettings({ ...settings, quietEnd: Number(e.target.value) })}>
                      {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                    </select>
                  </div>
                </div>
                <p className="text-xs text-slate-500">Email and push are held during this window ({settings.timezone}). In-app notifications always arrive.</p>
              </>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Save preferences"}</button>
        {msg ? <span className="text-sm text-slate-500">{msg}</span> : null}
      </div>
    </div>
  );
}

/**
 * VAPID public keys are base64url; the Push API wants a BufferSource backed by a
 * plain ArrayBuffer (not SharedArrayBuffer), so allocate the buffer explicitly.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
