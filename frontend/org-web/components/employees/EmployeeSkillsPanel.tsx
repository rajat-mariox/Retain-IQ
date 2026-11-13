"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, BadgeCheck, ThumbsUp, Trash2, X, Loader2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";

interface Skill {
  id: string; skillId: string; name: string; category: string | null;
  proficiency: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "EXPERT";
  yearsOfExp: number | null; verification: "SELF_DECLARED" | "VERIFIED" | "REJECTED";
  endorsements: number; note: string | null;
}

const PROF_LABEL: Record<Skill["proficiency"], string> = { BEGINNER: "Beginner", INTERMEDIATE: "Intermediate", ADVANCED: "Advanced", EXPERT: "Expert" };
const PROF_PCT: Record<Skill["proficiency"], number> = { BEGINNER: 25, INTERMEDIATE: 50, ADVANCED: 75, EXPERT: 100 };
const VERIF: Record<Skill["verification"], { label: string; cls: string }> = {
  SELF_DECLARED: { label: "Self-declared", cls: "bg-slate-100 text-slate-600" },
  VERIFIED: { label: "Verified", cls: "bg-emerald-500/10 text-emerald-700" },
  REJECTED: { label: "Rejected", cls: "bg-rose-500/10 text-rose-700" },
};

/** Skills tab: an employee's skills with proficiency, verification, endorsements. */
export function EmployeeSkillsPanel({ employeeId, canManage }: { employeeId: string; canManage: boolean }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [prof, setProf] = useState<Skill["proficiency"]>("INTERMEDIATE");
  const [years, setYears] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/employees/${employeeId}/skills`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setSkills(Array.isArray(d) ? d : []))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);

  async function post(url: string, body?: unknown, method = "POST") {
    setBusy(true); setError(null);
    const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? "That didn't work."); }
    setBusy(false);
    return res.ok;
  }

  async function add() {
    if (!name.trim()) return;
    const ok = await post(`/api/employees/${employeeId}/skills`, { skillName: name.trim(), proficiency: prof, yearsOfExp: years ? Number(years) : undefined });
    if (ok) { setOpen(false); setName(""); setProf("INTERMEDIATE"); setYears(""); load(); }
  }

  return (
    <Card>
      <CardHeader
        title="Skills"
        subtitle="Capabilities, proficiency & verification"
        action={canManage ? (
          <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"><Plus className="size-3.5" /> Add skill</button>
        ) : null}
      />
      <div className="p-4">
        {open && canManage ? (
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-hairline bg-panel-2 p-3">
            <div className="flex-1 min-w-40"><label className="mb-1 block text-xs text-slate-500">Skill</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kubernetes" className="w-full rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-sm" /></div>
            <div><label className="mb-1 block text-xs text-slate-500">Proficiency</label><select value={prof} onChange={(e) => setProf(e.target.value as Skill["proficiency"])} className="rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-sm">{Object.entries(PROF_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label className="mb-1 block text-xs text-slate-500">Years</label><input value={years} onChange={(e) => setYears(e.target.value)} type="number" min={0} className="w-20 rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-sm" /></div>
            <button onClick={add} disabled={busy || !name.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:brightness-95 disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : null} Add</button>
          </div>
        ) : null}
        {error ? <p className="mb-2 text-sm text-rose-600">{error}</p> : null}

        {loading ? (
          <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
        ) : skills.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No skills recorded yet.</p>
        ) : (
          <ul className="divide-y divide-hairline/60">
            {skills.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-40 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{s.name}</span>
                    {s.category ? <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-slate-500">{s.category}</span> : null}
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${VERIF[s.verification].cls}`}>{VERIF[s.verification].label}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="block h-1.5 w-24 overflow-hidden rounded-full bg-panel-2"><span className="block h-full rounded-full bg-brand" style={{ width: `${PROF_PCT[s.proficiency]}%` }} /></span>
                    <span className="text-xs text-slate-500">{PROF_LABEL[s.proficiency]}{s.yearsOfExp ? ` · ${s.yearsOfExp}y` : ""}</span>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-xs text-slate-400"><ThumbsUp className="size-3.5" /> {s.endorsements}</span>
                <div className="flex items-center gap-1">
                  <button onClick={async () => { if (await post(`/api/employees/skills/${s.id}/endorse`)) load(); }} title="Endorse" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand"><ThumbsUp className="size-4" /></button>
                  {canManage && s.verification !== "VERIFIED" ? <button onClick={async () => { if (await post(`/api/employees/skills/${s.id}/verify`, { approve: true })) load(); }} title="Verify" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600"><BadgeCheck className="size-4" /></button> : null}
                  {canManage ? <button onClick={async () => { if (await post(`/api/employees/skills/${s.id}`, undefined, "DELETE")) load(); }} title="Remove" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"><Trash2 className="size-4" /></button> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
