"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, UserRoundCheck, UserRoundX, Star } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";

interface Alum {
  id: string; employeeId: string; fullName: string; workEmail: string | null; personalEmail: string | null;
  joiningDate: string | null; exitDate: string | null; lastDesignation: string | null; lastDepartment: string | null;
  exitReason: string | null; rehireEligible: boolean; rehireRating: number | null;
}
const pretty = (s: string | null) => (s ? s.replace(/_/g, " ").toLowerCase() : "—");

/** Alumni directory: search former employees, filter rehire-eligible, toggle eligibility. */
export function AlumniWorkspace({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<Alum[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [onlyRehire, setOnlyRehire] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (q.trim()) qs.set("q", q.trim());
    if (onlyRehire) qs.set("rehireEligible", "1");
    fetch(`/api/employees/alumni${qs.toString() ? `?${qs}` : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [q, onlyRehire]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  async function toggleRehire(a: Alum) {
    const res = await fetch(`/api/employees/alumni/${a.id}/rehire`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rehireEligible: !a.rehireEligible }) });
    if (res.ok) load();
  }

  const eligible = useMemo(() => rows.filter((r) => r.rehireEligible).length, [rows]);
  const selectCls = "rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-700";

  return (
    <Card>
      <CardHeader title="Alumni" subtitle={`${rows.length} former employees · ${eligible} rehire-eligible`} />
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-panel-2/40 px-5 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, role" className={`${selectCls} w-64 pl-8`} />
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={onlyRehire} onChange={(e) => setOnlyRehire(e.target.checked)} className="size-4 accent-brand" /> Rehire-eligible only</label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-hairline text-xs text-slate-500">
              <th className="px-5 py-3 text-left font-medium">Name</th>
              <th className="px-5 py-3 text-left font-medium">Last role</th>
              <th className="px-5 py-3 text-left font-medium">Department</th>
              <th className="px-5 py-3 text-left font-medium">Tenure</th>
              <th className="px-5 py-3 text-left font-medium">Exit reason</th>
              <th className="px-5 py-3 text-left font-medium">Rehire</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-b border-hairline/60 last:border-0 hover:bg-slate-50">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={a.fullName} size={32} />
                    <div>
                      <p className="font-medium text-slate-900">{a.fullName}</p>
                      {a.workEmail ? <p className="text-xs text-slate-400">{a.workEmail}</p> : null}
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3 text-slate-600">{a.lastDesignation ?? "—"}</td>
                <td className="px-5 py-3 text-slate-600">{a.lastDepartment ?? "—"}</td>
                <td className="px-5 py-3 text-xs text-slate-500">{a.joiningDate ?? "?"} → {a.exitDate ?? "?"}</td>
                <td className="px-5 py-3 capitalize text-slate-600">{pretty(a.exitReason)}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${a.rehireEligible ? "bg-emerald-500/10 text-emerald-700" : "bg-rose-500/10 text-rose-700"}`}>
                      {a.rehireEligible ? <UserRoundCheck className="size-3" /> : <UserRoundX className="size-3" />} {a.rehireEligible ? "Eligible" : "No"}
                    </span>
                    {a.rehireRating ? <span className="inline-flex items-center gap-0.5 text-xs text-amber-600"><Star className="size-3" /> {a.rehireRating}</span> : null}
                    {canManage ? <button onClick={() => toggleRehire(a)} className="text-xs text-slate-400 hover:text-slate-700 hover:underline">toggle</button> : null}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">{loading ? "Loading…" : "No alumni yet."}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
