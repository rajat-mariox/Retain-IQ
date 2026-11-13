"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";

const control =
  "rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-sm text-slate-700 focus:border-brand focus:outline-none disabled:opacity-50";

/** Feed event types are namespaced ids; say them the way a person would. */
const TYPE_LABEL: Record<string, string> = {
  "org.created": "Organization created",
  "org.updated": "Organization updated",
  "org.activated": "Organization activated",
  "org.suspended": "Organization suspended",
  "org.deleted": "Organization deleted",
  "user.invited": "User added",
  "user.removed": "User removed",
  "feature.enabled": "Feature enabled",
  "feature.disabled": "Feature disabled",
  "feature.reset": "Feature reset",
  "subscription.created": "Subscription started",
  "subscription.plan_changed": "Plan changed",
  "subscription.renewed": "Subscription renewed",
  "subscription.canceled": "Subscription canceled",
  "subscription.suspended": "Subscription suspended",
  "payment.failed": "Payment failed",
};

export function ActivityFilters({
  types,
  organizations,
}: {
  types: string[];
  organizations: { id: string; name: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const current = {
    orgId: params.get("orgId") ?? "",
    type: params.get("type") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };
  const active = Object.values(current).some(Boolean);

  /** Filters live in the URL so a view survives refresh and can be shared. */
  const set = (key: string, value: string) =>
    start(() => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("page"); // a new filter always starts at page 1
      router.push(`/activity${next.toString() ? `?${next}` : ""}`);
    });

  const clear = () =>
    start(() => {
      router.push("/activity");
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className={control} value={current.orgId} onChange={(e) => set("orgId", e.target.value)} disabled={pending}>
        <option value="">All organizations</option>
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>

      <select className={control} value={current.type} onChange={(e) => set("type", e.target.value)} disabled={pending}>
        <option value="">All activity</option>
        {types.map((t) => (
          <option key={t} value={t}>
            {TYPE_LABEL[t] ?? t}
          </option>
        ))}
      </select>

      <span className="flex items-center gap-1.5">
        <input type="date" className={control} value={current.from} max={current.to || undefined} onChange={(e) => set("from", e.target.value)} disabled={pending} aria-label="From date" />
        <span className="text-xs text-slate-400">to</span>
        <input type="date" className={control} value={current.to} min={current.from || undefined} onChange={(e) => set("to", e.target.value)} disabled={pending} aria-label="To date" />
      </span>

      {active ? (
        <button onClick={clear} disabled={pending} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50">
          <X className="size-3.5" /> Clear
        </button>
      ) : null}
    </div>
  );
}
