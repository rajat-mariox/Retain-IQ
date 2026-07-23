"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, KanbanSquare, Plus, Users2 } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/cn";
import { useSubmitLock } from "@/lib/hooks";
import type {
  OrgDepartment,
  OrgDesignation,
  OrgTeam,
  RecApplication,
  RecCandidate,
  RecCard,
  RecPipeline,
  RecRequisition,
} from "@/lib/api";

type Tab = "pipeline" | "requisitions" | "candidates";

const STAGE_LABEL: Record<string, string> = { APPLIED: "Applied", SCREENING: "Screening", INTERVIEW: "Interview", OFFER: "Offer", HIRED: "Hired", REJECTED: "Rejected" };
const STAGE_TINT: Record<string, string> = {
  APPLIED: "border-slate-300",
  SCREENING: "border-sky-300",
  INTERVIEW: "border-violet-300",
  OFFER: "border-amber-300",
  HIRED: "border-emerald-300",
  REJECTED: "border-rose-300",
};
const REQ_STATUS_TINT: Record<string, string> = {
  OPEN: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
  ON_HOLD: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  FILLED: "bg-sky-500/10 text-sky-700 ring-sky-600/20",
  CLOSED: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
};
const OFFER_STATUS_TINT: Record<string, string> = {
  DRAFT: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
  SENT: "bg-sky-500/10 text-sky-700 ring-sky-600/20",
  ACCEPTED: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
  DECLINED: "bg-rose-500/10 text-rose-700 ring-rose-600/20",
  WITHDRAWN: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
};
const EMP_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"];

const btn = "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors";
const btnPrimary = cn(btn, "bg-slate-900 text-white hover:bg-slate-700");
const btnGhost = cn(btn, "border border-hairline bg-panel text-slate-700 hover:bg-panel-2");
const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400";
const label = "text-xs font-medium text-slate-600";

function pill(map: Record<string, string>, status: string) {
  return cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", map[status] ?? "bg-panel-2 text-slate-600 ring-hairline");
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

async function call(url: string, method: "POST" | "PATCH", body?: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (res.ok) return { ok: true };
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: data.error ?? "Something went wrong." };
}

export function RecruitmentWorkspace({
  pipeline,
  requisitions,
  candidates,
  departments,
  designations,
  teams,
}: {
  pipeline: RecPipeline;
  requisitions: RecRequisition[];
  candidates: RecCandidate[];
  departments: OrgDepartment[];
  designations: OrgDesignation[];
  teams: OrgTeam[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("pipeline");
  const [reqFilter, setReqFilter] = useState("");
  const [openReq, setOpenReq] = useState(false);
  const [openCand, setOpenCand] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const openReqs = useMemo(() => requisitions.filter((r) => r.status === "OPEN"), [requisitions]);

  const visiblePipeline = useMemo<RecPipeline>(() => {
    if (!reqFilter) return pipeline;
    const byStage = Object.fromEntries(pipeline.stages.map((s) => [s, (pipeline.byStage[s] ?? []).filter((c) => c.requisitionId === reqFilter)]));
    return { stages: pipeline.stages, byStage, total: Object.values(byStage).flat().length };
  }, [pipeline, reqFilter]);

  const summary = useMemo(() => {
    const total = requisitions.reduce((a, r) => a + r.candidates, 0);
    return {
      openReqs: openReqs.length,
      candidates: total,
      interviewing: pipeline.byStage.INTERVIEW?.length ?? 0,
      offers: pipeline.byStage.OFFER?.length ?? 0,
      hired: pipeline.byStage.HIRED?.length ?? 0,
    };
  }, [requisitions, openReqs, pipeline]);

  return (
    <div className="space-y-5">
      {/* summary tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { k: "Open roles", v: summary.openReqs },
          { k: "In pipeline", v: summary.candidates },
          { k: "Interviewing", v: summary.interviewing },
          { k: "Offers out", v: summary.offers },
          { k: "Hired", v: summary.hired },
        ].map((t) => (
          <Card key={t.k}>
            <CardBody className="p-4">
              <p className="text-xs text-slate-500">{t.k}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{t.v}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {([
          ["pipeline", "Pipeline", KanbanSquare],
          ["requisitions", "Requisitions", Briefcase],
          ["candidates", "Candidates", Users2],
        ] as const).map(([key, text, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(btn, "border", tab === key ? "border-slate-900 bg-slate-900 text-white" : "border-hairline bg-panel text-slate-600 hover:bg-panel-2")}
          >
            <Icon className="size-3.5" /> {text}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button type="button" className={btnGhost} onClick={() => setOpenCand(true)}>
            <Plus className="size-3.5" /> Add candidate
          </button>
          <button type="button" className={btnPrimary} onClick={() => setOpenReq(true)}>
            <Plus className="size-3.5" /> New requisition
          </button>
        </div>
      </div>

      {tab === "pipeline" && (
        <PipelineBoard pipeline={visiblePipeline} requisitions={requisitions} reqFilter={reqFilter} onReqFilter={setReqFilter} onOpen={setDetailId} />
      )}
      {tab === "requisitions" && <RequisitionsTab requisitions={requisitions} departments={departments} onSaved={() => router.refresh()} />}
      {tab === "candidates" && <CandidatesTab candidates={candidates} requisitions={openReqs} onOpenApplication={setDetailId} onSaved={() => router.refresh()} />}

      <RequisitionModal open={openReq} onClose={() => setOpenReq(false)} departments={departments} onSaved={() => { setOpenReq(false); router.refresh(); }} />
      <CandidateModal open={openCand} onClose={() => setOpenCand(false)} requisitions={openReqs} onSaved={() => { setOpenCand(false); router.refresh(); }} />
      {detailId && (
        <ApplicationDetail
          applicationId={detailId}
          departments={departments}
          designations={designations}
          teams={teams}
          onClose={() => setDetailId(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

/* ------------------------------- Pipeline ------------------------------- */
function PipelineBoard({
  pipeline,
  requisitions,
  reqFilter,
  onReqFilter,
  onOpen,
}: {
  pipeline: RecPipeline;
  requisitions: RecRequisition[];
  reqFilter: string;
  onReqFilter: (v: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader
        title="Hiring pipeline"
        subtitle={`${pipeline.total} application${pipeline.total === 1 ? "" : "s"}`}
        action={
          <select className={cn(input, "w-56")} value={reqFilter} onChange={(e) => onReqFilter(e.target.value)}>
            <option value="">All requisitions</option>
            {requisitions.map((r) => (
              <option key={r.id} value={r.id}>{r.title}</option>
            ))}
          </select>
        }
      />
      <CardBody className="overflow-x-auto p-4">
        <div className="flex min-w-[900px] gap-3">
          {pipeline.stages.map((stage) => {
            const cards = pipeline.byStage[stage] ?? [];
            return (
              <div key={stage} className="w-56 shrink-0">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{STAGE_LABEL[stage]}</span>
                  <span className="rounded-full bg-panel-2 px-1.5 text-xs text-slate-500">{cards.length}</span>
                </div>
                <div className="space-y-2">
                  {cards.map((c) => (
                    <PipelineCard key={c.id} card={c} stage={stage} onClick={() => onOpen(c.id)} />
                  ))}
                  {cards.length === 0 && <p className="rounded-lg border border-dashed border-hairline px-2 py-4 text-center text-xs text-slate-400">Empty</p>}
                </div>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

function PipelineCard({ card, stage, onClick }: { card: RecCard; stage: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("block w-full rounded-lg border-l-4 border border-hairline bg-panel px-3 py-2 text-left transition-shadow hover:shadow-md", STAGE_TINT[stage])}
    >
      <p className="truncate text-sm font-medium text-slate-900">{card.candidateName || "Unnamed"}</p>
      <p className="mt-0.5 truncate text-xs text-slate-500">{card.requisitionTitle}</p>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[11px] text-slate-400">{fmtDate(card.appliedAt)}</span>
        {card.rating ? <span className="text-[11px] text-amber-500">{"★".repeat(card.rating)}</span> : null}
      </div>
    </button>
  );
}

/* ------------------------------ Requisitions ---------------------------- */
function RequisitionsTab({
  requisitions,
  departments,
  onSaved,
}: {
  requisitions: RecRequisition[];
  departments: OrgDepartment[];
  onSaved: () => void;
}) {
  const [edit, setEdit] = useState<RecRequisition | null>(null);
  const { busy, run } = useSubmitLock();
  async function setStatus(r: RecRequisition, status: string) {
    await run(async () => {
      const res = await call(`/api/recruitment/requisitions/${r.id}`, "PATCH", { status });
      if (res.ok) onSaved();
      else alert(res.error);
    });
  }
  return (
    <Card>
      <CardHeader title="Requisitions" subtitle="Open roles you are hiring for" />
      <CardBody className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3">Role</th>
              <th className="px-5 py-3">Department</th>
              <th className="px-5 py-3">Openings</th>
              <th className="px-5 py-3">In pipeline</th>
              <th className="px-5 py-3">Hired</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {requisitions.map((r) => (
              <tr key={r.id} className="border-b border-hairline/60 last:border-0">
                <td className="px-5 py-3">
                  <p className="font-medium text-slate-900">{r.title}</p>
                  <p className="text-xs text-slate-500">{[r.location, r.employmentType?.replace("_", " ").toLowerCase()].filter(Boolean).join(" · ") || "—"}</p>
                </td>
                <td className="px-5 py-3 text-slate-600">{r.departmentName ?? "—"}</td>
                <td className="px-5 py-3 text-slate-600">{r.openings}</td>
                <td className="px-5 py-3 text-slate-600">{r.active}</td>
                <td className="px-5 py-3 text-slate-600">{r.hired}</td>
                <td className="px-5 py-3"><span className={pill(REQ_STATUS_TINT, r.status)}>{r.status.replace("_", " ").toLowerCase()}</span></td>
                <td className="px-5 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <button type="button" className={btnGhost} onClick={() => setEdit(r)}>Edit</button>
                    {r.status === "OPEN" ? (
                      <button type="button" disabled={busy} className={cn(btnGhost, "disabled:opacity-50")} onClick={() => setStatus(r, "ON_HOLD")}>Hold</button>
                    ) : r.status === "ON_HOLD" ? (
                      <button type="button" disabled={busy} className={cn(btnGhost, "disabled:opacity-50")} onClick={() => setStatus(r, "OPEN")}>Reopen</button>
                    ) : null}
                    {r.status !== "CLOSED" && r.status !== "FILLED" ? (
                      <button type="button" disabled={busy} className={cn(btnGhost, "disabled:opacity-50")} onClick={() => setStatus(r, "CLOSED")}>Close</button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {requisitions.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-400">No requisitions yet. Create one to start hiring.</td></tr>
            )}
          </tbody>
        </table>
      </CardBody>
      {edit && (
        <RequisitionModal
          open
          requisition={edit}
          departments={departments}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); onSaved(); }}
        />
      )}
    </Card>
  );
}

/* ------------------------------- Candidates ----------------------------- */
function CandidatesTab({
  candidates,
  requisitions,
  onOpenApplication,
  onSaved,
}: {
  candidates: RecCandidate[];
  requisitions: RecRequisition[];
  onOpenApplication: (id: string) => void;
  onSaved: () => void;
}) {
  const [applyFor, setApplyFor] = useState<RecCandidate | null>(null);
  return (
    <Card>
      <CardHeader title="Candidates" subtitle={`${candidates.length} in your talent pool`} />
      <CardBody className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Contact</th>
              <th className="px-5 py-3">Source</th>
              <th className="px-5 py-3">Applications</th>
              <th className="px-5 py-3">Added</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.id} className="border-b border-hairline/60 last:border-0">
                <td className="px-5 py-3 font-medium text-slate-900">{c.name}</td>
                <td className="px-5 py-3 text-slate-600">{c.email ?? c.phone ?? "—"}</td>
                <td className="px-5 py-3 text-slate-600">{c.source ?? "—"}</td>
                <td className="px-5 py-3 text-slate-600">{c.applications}</td>
                <td className="px-5 py-3 text-slate-600">{fmtDate(c.createdAt)}</td>
                <td className="px-5 py-3 text-right">
                  <button type="button" className={btnGhost} onClick={() => setApplyFor(c)}>Apply to role</button>
                </td>
              </tr>
            ))}
            {candidates.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-400">No candidates yet.</td></tr>
            )}
          </tbody>
        </table>
      </CardBody>
      {applyFor && (
        <ApplyModal
          candidate={applyFor}
          requisitions={requisitions}
          onClose={() => setApplyFor(null)}
          onApplied={(appId) => { setApplyFor(null); onSaved(); if (appId) onOpenApplication(appId); }}
        />
      )}
    </Card>
  );
}

/* ---------------------------- Requisition modal ------------------------- */
function RequisitionModal({
  open,
  onClose,
  requisition,
  departments,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  requisition?: RecRequisition;
  departments: OrgDepartment[];
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(requisition?.title ?? "");
  const [departmentId, setDepartmentId] = useState(requisition?.departmentId ?? "");
  const [location, setLocation] = useState(requisition?.location ?? "");
  const [employmentType, setEmploymentType] = useState(requisition?.employmentType ?? "");
  const [openings, setOpenings] = useState(String(requisition?.openings ?? 1));
  const [description, setDescription] = useState(requisition?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) return setErr("Role title is required.");
    setBusy(true);
    setErr(null);
    const payload = {
      title: title.trim(),
      departmentId: departmentId || null,
      location: location.trim() || null,
      employmentType: employmentType || null,
      description: description.trim() || null,
      openings: Number(openings) || 1,
    };
    const res = requisition
      ? await call(`/api/recruitment/requisitions/${requisition.id}`, "PATCH", payload)
      : await call("/api/recruitment/requisitions", "POST", payload);
    setBusy(false);
    if (res.ok) onSaved();
    else setErr(res.error ?? "Could not save.");
  }

  return (
    <Modal open={open} onClose={onClose} title={requisition ? "Edit requisition" : "New requisition"} size="lg">
      <div className="space-y-3">
        {err && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700">{err}</p>}
        <div>
          <label className={label}>Role title</label>
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior Backend Engineer" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Department</label>
            <select className={input} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">—</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Openings</label>
            <input type="number" min={1} className={input} value={openings} onChange={(e) => setOpenings(e.target.value)} />
          </div>
          <div>
            <label className={label}>Location</label>
            <input className={input} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Remote / Bengaluru" />
          </div>
          <div>
            <label className={label}>Employment type</label>
            <select className={input} value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}>
              <option value="">—</option>
              {EMP_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ").toLowerCase()}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={label}>Description</label>
          <textarea className={cn(input, "min-h-[90px]")} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Responsibilities, requirements…" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={submit}>{busy ? "Saving…" : requisition ? "Save changes" : "Create requisition"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ----------------------------- Candidate modal -------------------------- */
function CandidateModal({
  open,
  onClose,
  requisitions,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  requisitions: RecRequisition[];
  onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");
  const [requisitionId, setRequisitionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!firstName.trim() || !lastName.trim()) return setErr("First and last name are required.");
    setBusy(true);
    setErr(null);
    const res = await call("/api/recruitment/candidates", "POST", {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      source: source.trim() || undefined,
      requisitionId: requisitionId || undefined,
    });
    setBusy(false);
    if (res.ok) onSaved();
    else setErr(res.error ?? "Could not save.");
  }

  return (
    <Modal open={open} onClose={onClose} title="Add candidate" size="md">
      <div className="space-y-3">
        {err && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700">{err}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div><label className={label}>First name</label><input className={input} value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
          <div><label className={label}>Last name</label><input className={input} value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
        </div>
        <div><label className={label}>Email</label><input className={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="candidate@email.com" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={label}>Phone</label><input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div><label className={label}>Source</label><input className={input} value={source} onChange={(e) => setSource(e.target.value)} placeholder="LinkedIn, Referral…" /></div>
        </div>
        <div>
          <label className={label}>Apply to requisition (optional)</label>
          <select className={input} value={requisitionId} onChange={(e) => setRequisitionId(e.target.value)}>
            <option value="">Add to pool only</option>
            {requisitions.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={submit}>{busy ? "Saving…" : "Add candidate"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------- Apply modal ---------------------------- */
function ApplyModal({
  candidate,
  requisitions,
  onClose,
  onApplied,
}: {
  candidate: RecCandidate;
  requisitions: RecRequisition[];
  onClose: () => void;
  onApplied: (applicationId?: string) => void;
}) {
  const [requisitionId, setRequisitionId] = useState(requisitions[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!requisitionId) return setErr("Pick a requisition.");
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/recruitment/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateId: candidate.id, requisitionId }) });
    setBusy(false);
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      onApplied(data.id);
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Could not apply.");
    }
  }

  return (
    <Modal open onClose={onClose} title={`Apply ${candidate.name}`} size="sm">
      <div className="space-y-3">
        {err && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700">{err}</p>}
        <div>
          <label className={label}>Requisition</label>
          <select className={input} value={requisitionId} onChange={(e) => setRequisitionId(e.target.value)}>
            {requisitions.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={submit}>{busy ? "Applying…" : "Create application"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* --------------------------- Application detail ------------------------- */
const NEXT_STAGE: Record<string, string | null> = { APPLIED: "SCREENING", SCREENING: "INTERVIEW", INTERVIEW: "OFFER", OFFER: null, HIRED: null, REJECTED: null };
const OFFER_TINT_LABEL: Record<string, string> = OFFER_STATUS_TINT;

function ApplicationDetail({
  applicationId,
  departments,
  designations,
  teams,
  onClose,
  onChanged,
}: {
  applicationId: string;
  departments: OrgDepartment[];
  designations: OrgDesignation[];
  teams: OrgTeam[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [app, setApp] = useState<RecApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showInterview, setShowInterview] = useState(false);
  const [showOffer, setShowOffer] = useState(false);
  const [showHire, setShowHire] = useState(false);
  // One action at a time: the star rating in particular fires a PATCH per star,
  // so clicking "4" would otherwise send four concurrent writes.
  const { busy, run } = useSubmitLock();

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/recruitment/applications/${applicationId}`, { cache: "no-store" });
    if (res.ok) setApp((await res.json()) as RecApplication);
    else setErr("Could not load application.");
    setLoading(false);
  };
  // load on mount / when id changes
  useMemoLoad(applicationId, load);

  async function move(stage: string) {
    await run(async () => {
      const res = await call(`/api/recruitment/applications/${applicationId}`, "PATCH", { stage });
      if (res.ok) { await load(); onChanged(); }
      else alert(res.error);
    });
  }
  async function rate(rating: number) {
    await run(async () => {
      const res = await call(`/api/recruitment/applications/${applicationId}`, "PATCH", { rating });
      if (res.ok) { await load(); onChanged(); }
      else alert(res.error);
    });
  }
  async function reject() {
    const reason = window.prompt("Reason for rejecting (optional):") ?? "";
    await run(async () => {
      const res = await call(`/api/recruitment/applications/${applicationId}`, "PATCH", { stage: "REJECTED", rejectedReason: reason || null });
      if (res.ok) { await load(); onChanged(); }
      else alert(res.error);
    });
  }

  const canAct = app && app.stage !== "HIRED" && app.stage !== "REJECTED";
  const next = app ? NEXT_STAGE[app.stage] : null;

  return (
    <Modal open onClose={onClose} title={app ? app.candidate.name : "Application"} size="lg">
      {loading && <p className="py-8 text-center text-sm text-slate-400">Loading…</p>}
      {err && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700">{err}</p>}
      {app && (
        <div className="space-y-5">
          {/* header */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-900">{app.requisition.title}</p>
              <p className="text-xs text-slate-500">{[app.candidate.email, app.candidate.phone, app.candidate.source].filter(Boolean).join(" · ") || "—"}</p>
            </div>
            <div className="text-right">
              <span className={pill(REQ_STATUS_TINT, "OPEN")}>{STAGE_LABEL[app.stage] ?? app.stage}</span>
              <div className="mt-1 text-sm text-amber-500">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" disabled={busy} onClick={() => rate(n)} className={cn(n <= (app.rating ?? 0) ? "text-amber-500" : "text-slate-300", "disabled:opacity-50")}>★</button>
                ))}
              </div>
            </div>
          </div>

          {/* stage actions */}
          {canAct && (
            <div className="flex flex-wrap gap-2">
              {next && <button type="button" disabled={busy} className={cn(btnPrimary, "disabled:opacity-50")} onClick={() => move(next)}>Move to {STAGE_LABEL[next]}</button>}
              <button type="button" className={btnGhost} onClick={() => setShowInterview(true)}>Schedule interview</button>
              <button type="button" className={btnGhost} onClick={() => setShowOffer(true)}>Make offer</button>
              <button type="button" className={cn(btn, "bg-emerald-600 text-white hover:bg-emerald-500")} onClick={() => setShowHire(true)}>Hire</button>
              <button type="button" disabled={busy} className={cn(btn, "border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50")} onClick={reject}>Reject</button>
            </div>
          )}
          {app.stage === "HIRED" && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700">Hired — an employee record was created from this candidate.</p>}
          {app.stage === "REJECTED" && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700">Rejected{app.rejectedReason ? ` — ${app.rejectedReason}` : ""}.</p>}

          {/* interviews */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Interviews</h4>
            {app.interviews.length === 0 ? (
              <p className="text-xs text-slate-400">No interviews scheduled.</p>
            ) : (
              <div className="space-y-2">
                {app.interviews.map((i) => (
                  <div key={i.id} className="rounded-lg border border-hairline bg-panel-2 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-800">{i.round}{i.mode ? ` · ${i.mode}` : ""}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">{fmtDate(i.scheduledAt)}</span>
                        <OutcomeSelect interviewId={i.id} value={i.outcome} onChanged={() => { load(); }} />
                      </div>
                    </div>
                    {i.interviewer && <p className="text-xs text-slate-500">Interviewer: {i.interviewer}</p>}
                    {i.feedback && <p className="mt-1 text-xs text-slate-600">{i.feedback}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* offers */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Offers</h4>
            {app.offers.length === 0 ? (
              <p className="text-xs text-slate-400">No offers yet.</p>
            ) : (
              <div className="space-y-2">
                {app.offers.map((o) => (
                  <div key={o.id} className="rounded-lg border border-hairline bg-panel-2 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-800">{o.title ?? app.requisition.title}</p>
                      <span className={pill(OFFER_TINT_LABEL, o.status)}>{o.status.toLowerCase()}</span>
                    </div>
                    <p className="text-xs text-slate-500">{[o.salary, o.joiningDate ? `joins ${fmtDate(o.joiningDate)}` : null].filter(Boolean).join(" · ") || "—"}</p>
                    <OfferActions offerId={o.id} status={o.status} onChanged={() => { load(); }} />
                  </div>
                ))}
              </div>
            )}
          </section>

          {app.notes && (
            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</h4>
              <p className="text-sm text-slate-600">{app.notes}</p>
            </section>
          )}
        </div>
      )}

      {showInterview && <InterviewModal applicationId={applicationId} onClose={() => setShowInterview(false)} onSaved={() => { setShowInterview(false); load(); onChanged(); }} />}
      {showOffer && <OfferModal applicationId={applicationId} defaultTitle={app?.requisition.title ?? ""} onClose={() => setShowOffer(false)} onSaved={() => { setShowOffer(false); load(); onChanged(); }} />}
      {showHire && (
        <HireModal
          applicationId={applicationId}
          departments={departments}
          designations={designations}
          teams={teams}
          onClose={() => setShowHire(false)}
          onSaved={() => { setShowHire(false); load(); onChanged(); }}
        />
      )}
    </Modal>
  );
}

// tiny mount-effect helper to keep ApplicationDetail readable
function useMemoLoad(id: string, load: () => void) {
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
}

function OutcomeSelect({ interviewId, value, onChanged }: { interviewId: string; value: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <select
      className="rounded-md border border-hairline bg-panel px-2 py-0.5 text-xs text-slate-700"
      value={value}
      disabled={busy}
      onChange={async (e) => {
        setBusy(true);
        const res = await call(`/api/recruitment/interviews/${interviewId}`, "PATCH", { outcome: e.target.value });
        setBusy(false);
        if (res.ok) onChanged();
        else alert(res.error);
      }}
    >
      {["PENDING", "PASS", "FAIL", "HOLD"].map((o) => <option key={o} value={o}>{o.toLowerCase()}</option>)}
    </select>
  );
}

function OfferActions({ offerId, status, onChanged }: { offerId: string; status: string; onChanged: () => void }) {
  const { busy, run } = useSubmitLock();
  async function set(next: string) {
    await run(async () => {
      const res = await call(`/api/recruitment/offers/${offerId}`, "PATCH", { status: next });
      if (res.ok) onChanged();
      else alert(res.error);
    });
  }
  const actions: [string, string][] = [];
  if (status === "DRAFT") actions.push(["Send", "SENT"]);
  if (status === "SENT") { actions.push(["Mark accepted", "ACCEPTED"], ["Mark declined", "DECLINED"]); }
  if (actions.length === 0) return null;
  return (
    <div className="mt-1.5 flex gap-2">
      {actions.map(([txt, val]) => (
        <button key={val} type="button" disabled={busy} className={cn(btn, "border border-hairline bg-panel px-2 py-1 text-slate-600 hover:bg-panel disabled:opacity-50")} onClick={() => set(val)}>{txt}</button>
      ))}
    </div>
  );
}

function InterviewModal({ applicationId, onClose, onSaved }: { applicationId: string; onClose: () => void; onSaved: () => void }) {
  const [round, setRound] = useState("Technical round");
  const [scheduledAt, setScheduledAt] = useState("");
  const [interviewer, setInterviewer] = useState("");
  const [mode, setMode] = useState("Video");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    if (!round.trim()) return setErr("Round name is required.");
    setBusy(true);
    setErr(null);
    const res = await call(`/api/recruitment/applications/${applicationId}/interviews`, "POST", {
      round: round.trim(),
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      interviewer: interviewer.trim() || undefined,
      mode,
    });
    setBusy(false);
    if (res.ok) onSaved();
    else setErr(res.error ?? "Could not save.");
  }
  return (
    <Modal open onClose={onClose} title="Schedule interview" size="md">
      <div className="space-y-3">
        {err && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700">{err}</p>}
        <div><label className={label}>Round</label><input className={input} value={round} onChange={(e) => setRound(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={label}>When</label><input type="datetime-local" className={input} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></div>
          <div>
            <label className={label}>Mode</label>
            <select className={input} value={mode} onChange={(e) => setMode(e.target.value)}>
              {["Video", "Onsite", "Phone"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
        <div><label className={label}>Interviewer</label><input className={input} value={interviewer} onChange={(e) => setInterviewer(e.target.value)} placeholder="Name" /></div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={submit}>{busy ? "Saving…" : "Schedule"}</button>
        </div>
      </div>
    </Modal>
  );
}

function OfferModal({ applicationId, defaultTitle, onClose, onSaved }: { applicationId: string; defaultTitle: string; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(defaultTitle);
  const [salary, setSalary] = useState("");
  const [joiningDate, setJoiningDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setErr(null);
    const res = await call(`/api/recruitment/applications/${applicationId}/offers`, "POST", {
      title: title.trim() || undefined,
      salary: salary.trim() || undefined,
      joiningDate: joiningDate ? new Date(joiningDate).toISOString() : undefined,
      note: note.trim() || undefined,
    });
    setBusy(false);
    if (res.ok) onSaved();
    else setErr(res.error ?? "Could not save.");
  }
  return (
    <Modal open onClose={onClose} title="Make an offer" size="md">
      <div className="space-y-3">
        {err && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700">{err}</p>}
        <div><label className={label}>Title</label><input className={input} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={label}>Salary</label><input className={input} value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="₹18,00,000 / yr" /></div>
          <div><label className={label}>Joining date</label><input type="date" className={input} value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} /></div>
        </div>
        <div><label className={label}>Note</label><textarea className={cn(input, "min-h-[70px]")} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={submit}>{busy ? "Saving…" : "Create offer"}</button>
        </div>
      </div>
    </Modal>
  );
}

function HireModal({
  applicationId,
  departments,
  designations,
  teams,
  onClose,
  onSaved,
}: {
  applicationId: string;
  departments: OrgDepartment[];
  designations: OrgDesignation[];
  teams: OrgTeam[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [employeeCode, setEmployeeCode] = useState("");
  const [joinedAt, setJoinedAt] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setErr(null);
    const res = await call(`/api/recruitment/applications/${applicationId}/hire`, "POST", {
      employeeCode: employeeCode.trim() || undefined,
      joinedAt: joinedAt ? new Date(joinedAt).toISOString() : undefined,
      departmentId: departmentId || undefined,
      designationId: designationId || undefined,
      teamId: teamId || undefined,
    });
    setBusy(false);
    if (res.ok) onSaved();
    else setErr(res.error ?? "Could not hire.");
  }
  return (
    <Modal open onClose={onClose} title="Hire candidate" size="md">
      <div className="space-y-3">
        {err && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700">{err}</p>}
        <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700">This creates an active employee record from the candidate and starts onboarding.</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={label}>Employee code</label><input className={input} value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} placeholder="EMP-042" /></div>
          <div><label className={label}>Joining date</label><input type="date" className={input} value={joinedAt} onChange={(e) => setJoinedAt(e.target.value)} /></div>
          <div>
            <label className={label}>Department</label>
            <select className={input} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">From requisition</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Designation</label>
            <select className={input} value={designationId} onChange={(e) => setDesignationId(e.target.value)}>
              <option value="">From requisition</option>
              {designations.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className={label}>Team</label>
            <select className={input} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">Unassigned</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button type="button" className={cn(btn, "bg-emerald-600 text-white hover:bg-emerald-500")} disabled={busy} onClick={submit}>{busy ? "Hiring…" : "Confirm hire"}</button>
        </div>
      </div>
    </Modal>
  );
}
