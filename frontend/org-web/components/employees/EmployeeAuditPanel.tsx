"use client";

import { useEffect, useState } from "react";
import { ScrollText, ShieldCheck } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { LocalTime } from "@/components/ui/LocalTime";

interface AuditRow { id: string; action: string; actorUserId: string | null; ipAddress: string | null; occurredAt: string }

const pretty = (a: string) => a.replace(/^employee\./, "").replace(/_/g, " ");

/** Audit tab: the append-only audit trail for this employee (audit.read). */
export function EmployeeAuditPanel({ employeeId }: { employeeId: string }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/employees/${employeeId}/audit`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [employeeId]);

  return (
    <Card>
      <CardHeader
        title="Audit trail"
        subtitle="Every sensitive action on this employee — append-only"
        action={<span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700"><ShieldCheck className="size-3" /> tamper-proof</span>}
      />
      <div className="p-4">
        {loading ? <p className="py-4 text-center text-sm text-slate-500">Loading…</p> : rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">No audited actions yet.</p>
        ) : (
          <ol className="relative space-y-3 border-l border-hairline pl-5">
            {rows.map((r) => (
              <li key={r.id} className="relative">
                <span className="absolute -left-[27px] top-1 grid size-5 place-items-center rounded-full bg-slate-100 text-slate-400 ring-2 ring-panel"><ScrollText className="size-3" /></span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium capitalize text-slate-800">{pretty(r.action)}</span>
                  <span className="text-[11px] text-slate-400"><LocalTime iso={r.occurredAt} /></span>
                </div>
                <p className="text-[11px] text-slate-400">actor {r.actorUserId ? r.actorUserId.slice(0, 8) : "system"}{r.ipAddress ? ` · ${r.ipAddress}` : ""}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}
