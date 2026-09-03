"use client";

import { useCallback, useEffect, useState } from "react";
import { Landmark, Loader2 } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { readError } from "./workspace-shared";
import type { PayrollAccess } from "./access";

/**
 * Org opt-in for the tax + statutory flow (§13). The owner turns income tax +
 * PF/ESI/PT on or off for the whole org; when off, payroll computes earnings and
 * components with no TDS/statutory deductions. Backed by GET/PATCH
 * /api/payroll/tax/settings — the PATCH additionally needs payroll.tax.configure.
 */
export function TaxSettingsPanel({ can }: { can: PayrollAccess }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/payroll/tax/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: { taxEnabled: boolean }) => setEnabled(Boolean(d.taxEnabled)))
      .catch(async (r) => setError(await readError(r, "Could not load tax settings.")));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggle(next: boolean) {
    setSaving(true); setError(null);
    const prev = enabled;
    setEnabled(next); // optimistic
    try {
      const res = await fetch("/api/payroll/tax/settings", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ taxEnabled: next }),
      });
      if (!res.ok) throw res;
      const d = (await res.json()) as { taxEnabled: boolean };
      setEnabled(Boolean(d.taxEnabled));
    } catch (r) {
      setEnabled(prev ?? false); // revert
      setError(await readError(r, "Could not update tax settings."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Tax & statutory"
        subtitle="Turn income tax (TDS) and PF / ESI / PT on for this organization's payroll"
      />
      <CardBody className="space-y-3">
        {error ? <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</div> : null}
        <div className="flex items-center justify-between gap-4 rounded-xl border border-hairline bg-panel-2/40 px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-9 place-items-center rounded-xl bg-brand/10 text-brand ring-1 ring-inset ring-brand/20">
              <Landmark className="size-4.5" />
            </span>
            <div>
              <p className="text-sm font-medium text-slate-900">Run tax & statutory deductions</p>
              <p className="text-xs text-slate-500">
                {enabled === null ? "Loading…" : enabled
                  ? "ON — payroll computes TDS, PF, ESI and PT from your configured rules."
                  : "OFF — payroll pays earnings + allowances only, with no tax/statutory deductions."}
              </p>
            </div>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={Boolean(enabled)}
              disabled={enabled === null || saving || !can.canBatchCreate}
              onChange={(e) => toggle(e.target.checked)}
            />
            <div className="h-6 w-11 rounded-full bg-slate-300 transition-colors peer-checked:bg-brand peer-disabled:opacity-50 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-transform after:content-[''] peer-checked:after:translate-x-5" />
            {saving ? <Loader2 className="ml-2 size-4 animate-spin text-slate-400" /> : null}
          </label>
        </div>
        <p className="text-xs text-slate-400">
          Rules (slabs, PF/ESI/PT rates) are configured separately and are effective-dated —
          verify them against the current statutory notifications before running production payroll.
        </p>
      </CardBody>
    </Card>
  );
}
