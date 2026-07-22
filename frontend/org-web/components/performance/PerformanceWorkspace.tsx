"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Award, ChevronLeft, Plus, Trash2, Users2 } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/cn";
import type { PerfCycle, PerfCycleReviews, PerfHistory, PerfReview } from "@/lib/api";

interface EmpLite { id: string; name: string }

const CYCLE_TINT: Record<string, string> = {
  DRAFT: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
  ACTIVE: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
  CLOSED: "bg-sky-500/10 text-sky-700 ring-sky-600/20",
};
const REVIEW_TINT: Record<string, string> = {
  PENDING: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
  SELF_REVIEW: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  IN_REVIEW: "bg-violet-500/10 text-violet-700 ring-violet-600/20",
  SUBMITTED: "bg-sky-500/10 text-sky-700 ring-sky-600/20",
  ACKNOWLEDGED: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
};
const STATUS_FLOW = ["PENDING", "SELF_REVIEW", "IN_REVIEW", "SUBMITTED", "ACKNOWLEDGED"];

const btn = "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors";
const btnPrimary = cn(btn, "bg-slate-900 text-white hover:bg-slate-700");
const btnGhost = cn(btn, "border border-hairline bg-panel text-slate-700 hover:bg-panel-2");
const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400";
const label = "text-xs font-medium text-slate-600";

function pill(map: Record<string, string>, k: string) {
  return cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", map[k] ?? "bg-panel-2 text-slate-600 ring-hairline");
}
function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
}
async function call(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  const res = await fetch(url, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, data };
  return { ok: false, error: (data as { error?: string }).error ?? "Something went wrong." };
}
function Stars({ value, onPick, readOnly }: { value: number | null; onPick?: (n: number) => void; readOnly?: boolean }) {
  return (
    <span className="text-sm">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={readOnly} onClick={() => onPick?.(n)} className={cn(n <= (value ?? 0) ? "text-amber-500" : "text-slate-300", !readOnly && "hover:text-amber-400")}>★</button>
      ))}
    </span>
  );
}

export function PerformanceWorkspace({ cycles, employees }: { cycles: PerfCycle[]; employees: EmpLite[] }) {
  const router = useRouter();
  const [openCycle, setOpenCycle] = useState<PerfCycle | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);

  if (openCycle) {
    return (
      <>
        <CycleReviews cycle={openCycle} employees={employees} onBack={() => setOpenCycle(null)} onOpenReview={setReviewId} onChanged={() => router.refresh()} />
        {reviewId && <ReviewModal reviewId={reviewId} onClose={() => setReviewId(null)} onChanged={() => router.refresh()} />}
      </>
    );
  }
  return (
    <>
      <CyclesList cycles={cycles} onOpen={setOpenCycle} onChanged={() => router.refresh()} />
      {reviewId && <ReviewModal reviewId={reviewId} onClose={() => setReviewId(null)} onChanged={() => router.refresh()} />}
    </>
  );
}

/* -------------------------------- Cycles -------------------------------- */
function CyclesList({ cycles, onOpen, onChanged }: { cycles: PerfCycle[]; onOpen: (c: PerfCycle) => void; onChanged: () => void }) {
  const [openNew, setOpenNew] = useState(false);
  const active = cycles.find((c) => c.status === "ACTIVE");
  async function setStatus(c: PerfCycle, status: string) {
    const res = await call(`/api/performance/cycles/${c.id}`, "PATCH", { status });
    if (res.ok) onChanged(); else alert(res.error);
  }
  async function remove(c: PerfCycle) {
    if (!confirm(`Delete cycle "${c.name}" and all its reviews?`)) return;
    const res = await call(`/api/performance/cycles/${c.id}`, "DELETE");
    if (res.ok) onChanged(); else alert(res.error);
  }
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { k: "Cycles", v: cycles.length },
          { k: "Active cycle", v: active ? active.name : "—" },
          { k: "Reviews (active)", v: active ? active.reviews : 0 },
          { k: "Completion", v: active ? `${active.percent}%` : "—" },
        ].map((t) => (
          <Card key={t.k}><CardBody className="p-4"><p className="text-xs text-slate-500">{t.k}</p><p className="mt-1 truncate text-2xl font-semibold text-slate-900">{t.v}</p></CardBody></Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Review cycles" subtitle="Appraisal periods for the whole org" action={<button type="button" className={btnPrimary} onClick={() => setOpenNew(true)}><Plus className="size-3.5" /> New cycle</button>} />
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3">Cycle</th>
                <th className="px-5 py-3">Period</th>
                <th className="px-5 py-3">Reviews</th>
                <th className="px-5 py-3">Completion</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {cycles.map((c) => (
                <tr key={c.id} className="border-b border-hairline/60 last:border-0">
                  <td className="px-5 py-3 font-medium text-slate-900">{c.name}</td>
                  <td className="px-5 py-3 text-slate-600">{c.periodStart || c.periodEnd ? `${fmtDate(c.periodStart)} – ${fmtDate(c.periodEnd)}` : "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{c.completed}/{c.reviews}</td>
                  <td className="px-5 py-3 text-slate-600">{c.percent}%</td>
                  <td className="px-5 py-3"><span className={pill(CYCLE_TINT, c.status)}>{c.status.toLowerCase()}</span></td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button type="button" className={btnPrimary} onClick={() => onOpen(c)}>Open</button>
                      {c.status === "DRAFT" && <button type="button" className={btnGhost} onClick={() => setStatus(c, "ACTIVE")}>Activate</button>}
                      {c.status === "ACTIVE" && <button type="button" className={btnGhost} onClick={() => setStatus(c, "CLOSED")}>Close</button>}
                      <button type="button" className={cn(btn, "text-rose-500 hover:bg-rose-50")} onClick={() => remove(c)}><Trash2 className="size-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {cycles.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-400">No review cycles yet. Create one to start appraisals.</td></tr>}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {openNew && <NewCycleModal onClose={() => setOpenNew(false)} onSaved={() => { setOpenNew(false); onChanged(); }} />}
    </div>
  );
}

function NewCycleModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    if (!name.trim()) return setErr("Name is required.");
    setBusy(true); setErr(null);
    const res = await call("/api/performance/cycles", "POST", { name: name.trim(), periodStart: start ? new Date(start).toISOString() : undefined, periodEnd: end ? new Date(end).toISOString() : undefined });
    setBusy(false);
    if (res.ok) onSaved(); else setErr(res.error ?? "Could not save.");
  }
  return (
    <Modal open onClose={onClose} title="New review cycle" size="md">
      <div className="space-y-3">
        {err && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700">{err}</p>}
        <div><label className={label}>Name</label><input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="H2 2026 Appraisal" autoFocus /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={label}>Period start</label><input type="date" className={input} value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div><label className={label}>Period end</label><input type="date" className={input} value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={submit}>{busy ? "Saving…" : "Create cycle"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------- Cycle reviews ----------------------------- */
function CycleReviews({ cycle, employees, onBack, onOpenReview, onChanged }: { cycle: PerfCycle; employees: EmpLite[]; onBack: () => void; onOpenReview: (id: string) => void; onChanged: () => void }) {
  const [data, setData] = useState<PerfCycleReviews | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [pickEmp, setPickEmp] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/performance/cycles/${cycle.id}/reviews`, { cache: "no-store" });
    if (res.ok) setData((await res.json()) as PerfCycleReviews);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cycle.id]);

  const existingIds = useMemo(() => new Set((data?.reviews ?? []).map((r) => r.employeeId)), [data]);
  const addable = employees.filter((e) => !existingIds.has(e.id));

  async function generate() {
    if (!confirm("Create a review for every active employee not already in this cycle?")) return;
    setBusy(true);
    const res = await call(`/api/performance/cycles/${cycle.id}/generate`, "POST", {});
    setBusy(false);
    if (res.ok) { await load(); onChanged(); } else alert(res.error);
  }
  async function addOne() {
    if (!pickEmp) return;
    setBusy(true);
    const res = await call(`/api/performance/cycles/${cycle.id}/reviews`, "POST", { employeeId: pickEmp });
    setBusy(false);
    if (res.ok) { setAdding(false); setPickEmp(""); await load(); onChanged(); } else alert(res.error);
  }

  return (
    <div className="space-y-4">
      <button type="button" className={btnGhost} onClick={onBack}><ChevronLeft className="size-3.5" /> All cycles</button>
      <Card>
        <CardHeader
          title={cycle.name}
          subtitle={`${data?.reviews.length ?? 0} review${(data?.reviews.length ?? 0) === 1 ? "" : "s"} · ${cycle.status.toLowerCase()}`}
          action={
            <div className="flex gap-2">
              <button type="button" className={btnGhost} disabled={busy} onClick={() => setAdding((v) => !v)}><Plus className="size-3.5" /> Add employee</button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={generate}><Users2 className="size-3.5" /> Generate for all</button>
            </div>
          }
        />
        {adding && (
          <div className="flex items-center gap-2 border-b border-hairline bg-panel-2 px-5 py-3">
            <select className={cn(input, "max-w-xs")} value={pickEmp} onChange={(e) => setPickEmp(e.target.value)}>
              <option value="">Select employee…</option>
              {addable.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <button type="button" className={btnPrimary} disabled={busy || !pickEmp} onClick={addOne}>Add</button>
          </div>
        )}
        <CardBody className="overflow-x-auto p-0">
          {loading ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">Loading…</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3">Employee</th>
                  <th className="px-5 py-3">Competency avg</th>
                  <th className="px-5 py-3">Overall</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {(data?.reviews ?? []).map((r) => (
                  <tr key={r.id} className="cursor-pointer border-b border-hairline/60 last:border-0 hover:bg-panel-2" onClick={() => onOpenReview(r.id)}>
                    <td className="px-5 py-3"><p className="font-medium text-slate-900">{r.employeeName}</p><p className="text-xs text-slate-500">{r.title ?? "—"}</p></td>
                    <td className="px-5 py-3 text-slate-600">{r.competencyAvg ?? "—"}</td>
                    <td className="px-5 py-3"><Stars value={r.overallRating} readOnly /></td>
                    <td className="px-5 py-3"><span className={pill(REVIEW_TINT, r.status)}>{r.status.replace("_", " ").toLowerCase()}</span></td>
                    <td className="px-5 py-3 text-right"><span className={btnGhost}>Open review</span></td>
                  </tr>
                ))}
                {(data?.reviews.length ?? 0) === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">No reviews yet. Add an employee or generate for everyone.</td></tr>}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

/* ----------------------------- Review modal ----------------------------- */
function ReviewModal({ reviewId, onClose, onChanged }: { reviewId: string; onClose: () => void; onChanged: () => void }) {
  const [review, setReview] = useState<PerfReview | null>(null);
  const [history, setHistory] = useState<PerfHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addAch, setAddAch] = useState(false);

  // editable buffers
  const [ratings, setRatings] = useState<{ competency: string; score: number; comment: string | null }[]>([]);
  const [overall, setOverall] = useState<number | null>(null);
  const [self, setSelf] = useState("");
  const [strengths, setStrengths] = useState("");
  const [improvements, setImprovements] = useState("");
  const [managerComment, setManagerComment] = useState("");

  const load = async () => {
    setLoading(true);
    const rRes = await fetch(`/api/performance/reviews/${reviewId}`, { cache: "no-store" });
    if (rRes.ok) {
      const r = (await rRes.json()) as PerfReview;
      setReview(r);
      setRatings(r.ratings.length ? r.ratings.map((x) => ({ competency: x.competency, score: x.score, comment: x.comment })) : r.competencyOptions.map((c) => ({ competency: c, score: 0, comment: null })));
      setOverall(r.overallRating);
      setSelf(r.selfAssessment ?? "");
      setStrengths(r.strengths ?? "");
      setImprovements(r.improvements ?? "");
      setManagerComment(r.managerComment ?? "");
      const perfRes = await fetch(`/api/performance/employees/${r.employee.id}`, { cache: "no-store" });
      if (perfRes.ok) setHistory((await perfRes.json()) as PerfHistory);
    }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [reviewId]);

  async function saveAll() {
    setSaving(true);
    const r1 = await call(`/api/performance/reviews/${reviewId}`, "PATCH", { overallRating: overall, selfAssessment: self.trim() || null, strengths: strengths.trim() || null, improvements: improvements.trim() || null, managerComment: managerComment.trim() || null });
    const r2 = await call(`/api/performance/reviews/${reviewId}/ratings`, "PATCH", { ratings: ratings.filter((x) => x.score > 0) });
    setSaving(false);
    if (r1.ok && r2.ok) { await load(); onChanged(); } else alert(r1.error ?? r2.error);
  }
  async function setStatus(status: string) {
    const res = await call(`/api/performance/reviews/${reviewId}`, "PATCH", { status });
    if (res.ok) { await load(); onChanged(); } else alert(res.error);
  }

  const nextStatus = review ? STATUS_FLOW[STATUS_FLOW.indexOf(review.status) + 1] : undefined;

  return (
    <Modal open onClose={onClose} title={review ? `Review · ${review.employee.name}` : "Review"} size="lg">
      {loading && <p className="py-8 text-center text-sm text-slate-400">Loading…</p>}
      {review && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm text-slate-500">{review.cycle.name}{review.employee.title ? ` · ${review.employee.title}` : ""}</p>
              {review.reviewerName && <p className="text-xs text-slate-400">Reviewer: {review.reviewerName}</p>}
            </div>
            <div className="text-right">
              <span className={pill(REVIEW_TINT, review.status)}>{review.status.replace("_", " ").toLowerCase()}</span>
              {history?.averageRating != null && <p className="mt-1 text-xs text-slate-400">Career avg: {history.averageRating}★</p>}
            </div>
          </div>

          {/* overall */}
          <div className="flex items-center justify-between rounded-lg border border-hairline bg-panel-2 px-4 py-3">
            <span className="text-sm font-medium text-slate-700">Overall rating</span>
            <Stars value={overall} onPick={setOverall} />
          </div>

          {/* competencies */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Competencies</h4>
            <div className="space-y-2">
              {ratings.map((rt, i) => (
                <div key={rt.competency} className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-panel px-3 py-2">
                  <span className="text-sm text-slate-700">{rt.competency}</span>
                  <Stars value={rt.score} onPick={(n) => setRatings((prev) => prev.map((x, j) => (j === i ? { ...x, score: n } : x)))} />
                </div>
              ))}
            </div>
          </section>

          {/* narrative */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className={label}>Self-assessment</label><textarea className={cn(input, "min-h-[80px]")} value={self} onChange={(e) => setSelf(e.target.value)} /></div>
            <div><label className={label}>Manager comment</label><textarea className={cn(input, "min-h-[80px]")} value={managerComment} onChange={(e) => setManagerComment(e.target.value)} /></div>
            <div><label className={label}>Strengths</label><textarea className={cn(input, "min-h-[70px]")} value={strengths} onChange={(e) => setStrengths(e.target.value)} /></div>
            <div><label className={label}>Areas to improve</label><textarea className={cn(input, "min-h-[70px]")} value={improvements} onChange={(e) => setImprovements(e.target.value)} /></div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btnPrimary} disabled={saving} onClick={saveAll}>{saving ? "Saving…" : "Save review"}</button>
            {nextStatus && <button type="button" className={btnGhost} onClick={() => setStatus(nextStatus)}>Move to {nextStatus.replace("_", " ").toLowerCase()}</button>}
          </div>

          {/* achievements */}
          <section className="border-t border-hairline pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Award className="size-3.5" /> Recognition & achievements</h4>
              <button type="button" className={btnGhost} onClick={() => setAddAch(true)}><Plus className="size-3.5" /> Add</button>
            </div>
            {addAch && <AddAchievement employeeId={review.employee.id} onDone={() => { setAddAch(false); load(); }} onCancel={() => setAddAch(false)} />}
            <div className="space-y-2">
              {(history?.achievements ?? []).map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-3 rounded-lg border border-hairline bg-panel px-3 py-2">
                  <div><p className="text-sm font-medium text-slate-800">{a.title}{a.category ? ` · ${a.category.toLowerCase()}` : ""}</p>{a.description && <p className="text-xs text-slate-500">{a.description}</p>}<p className="text-[11px] text-slate-400">{fmtDate(a.awardedOn)}</p></div>
                  <button type="button" className="shrink-0 text-slate-300 hover:text-rose-500" onClick={async () => { const res = await call(`/api/performance/achievements/${a.id}`, "DELETE"); if (res.ok) load(); else alert(res.error); }}><Trash2 className="size-4" /></button>
                </div>
              ))}
              {(history?.achievements.length ?? 0) === 0 && !addAch && <p className="text-xs text-slate-400">No achievements recorded yet.</p>}
            </div>
          </section>

          {/* past reviews */}
          {history && history.reviews.length > 1 && (
            <section className="border-t border-hairline pt-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Review history</h4>
              <div className="space-y-1">
                {history.reviews.map((h) => (
                  <div key={h.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{h.cycleName}</span>
                    <span className="flex items-center gap-2"><Stars value={h.overallRating} readOnly /><span className={pill(REVIEW_TINT, h.status)}>{h.status.replace("_", " ").toLowerCase()}</span></span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

function AddAchievement({ employeeId, onDone, onCancel }: { employeeId: string; onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("KUDOS");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!title.trim()) return;
    setBusy(true);
    const res = await call(`/api/performance/employees/${employeeId}/achievements`, "POST", { title: title.trim(), category, description: description.trim() || undefined });
    setBusy(false);
    if (res.ok) onDone(); else alert(res.error);
  }
  return (
    <div className="mb-2 space-y-2 rounded-lg border border-hairline bg-panel-2 p-3">
      <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Shipped the billing revamp" autoFocus />
      <div className="flex flex-wrap items-center gap-2">
        <select className={cn(input, "w-auto")} value={category} onChange={(e) => setCategory(e.target.value)}>{["KUDOS", "AWARD", "MILESTONE", "CERTIFICATION", "OTHER"].map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}</select>
        <input className={cn(input, "flex-1")} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional detail" />
        <button type="button" className={btnPrimary} disabled={busy} onClick={submit}>Add</button>
        <button type="button" className={btnGhost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
