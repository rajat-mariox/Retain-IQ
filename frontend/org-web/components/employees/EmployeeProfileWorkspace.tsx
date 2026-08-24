"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, FileText, Pencil, Plus, Trash2, Upload, UserRound } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import type { EmployeeDocumentRow, EmployeeProfile, EmploymentEventRow } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { EmployeeCasesPanel } from "./EmployeeCasesPanel";
import { EmployeeSkillsPanel } from "./EmployeeSkillsPanel";
import { EmployeeCertificationsPanel } from "./EmployeeCertificationsPanel";
import { EmployeeCareerPanel } from "./EmployeeCareerPanel";
import { EmployeeExitPanel } from "./EmployeeExitPanel";
import { EmployeeProbationPanel } from "./EmployeeProbationPanel";
import { Employee360Panel } from "./Employee360Panel";
import { EmployeeRemarksPanel } from "./EmployeeRemarksPanel";
import { EmployeeRecognitionPanel } from "./EmployeeRecognitionPanel";
import { EmployeeAuditPanel } from "./EmployeeAuditPanel";
import { EmployeeRecommendationsPanel } from "./EmployeeRecommendationsPanel";

const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none";
const label = "mb-1 block text-xs font-medium text-slate-500";
const toIso = (d: string) => (d ? new Date(`${d}T00:00:00.000Z`).toISOString() : null);
const WORK_MODEL: Record<string, string> = { WFO: "On-site", WFH: "Remote", HYBRID: "Hybrid" };
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Human label for a work model, appending on-site days for hybrid. */
function workModelLabel(model: string | null, officeDays: number[] | undefined): string {
  if (!model) return "Org default";
  const base = WORK_MODEL[model] ?? model;
  if (model === "HYBRID" && officeDays && officeDays.length > 0) return `${base} · ${officeDays.map((d) => DOW_SHORT[d]).join(", ")}`;
  return base;
}
const initials = (n: string) => n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const STAGE: Record<string, string> = { ONBOARDING: "bg-sky-50 text-sky-700 ring-sky-200", PROBATION: "bg-amber-50 text-amber-700 ring-amber-200", CONFIRMED: "bg-emerald-50 text-emerald-700 ring-emerald-200", EXITED: "bg-slate-100 text-slate-500 ring-slate-200" };
const DOC_CATS = [
  { key: "OFFER_LETTER", label: "Offer letter" },
  { key: "CONTRACT", label: "Contract" },
  { key: "ID_PROOF", label: "ID proof" },
  { key: "COMPLIANCE", label: "Compliance" },
  { key: "OTHER", label: "Other" },
];
const EVENT_TONE: Record<string, string> = { JOINED: "bg-emerald-500", PROMOTION: "bg-violet-500", TRANSFER: "bg-sky-500", TITLE_CHANGE: "bg-sky-500", STATUS_CHANGE: "bg-amber-500", LIFECYCLE: "bg-brand", EXIT: "bg-rose-500", AWARD: "bg-amber-500", NOTE: "bg-slate-400" };
const fmtBytes = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

type Options = {
  departments: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  designations: { id: string; title: string; level: string | null }[];
  shifts: { id: string; name: string }[];
  rotations: { id: string; name: string }[];
  managers: { id: string; name: string }[];
};
type Tab = "overview" | "reporting" | "career" | "probation" | "recognition" | "remarks" | "skills" | "certifications" | "documents" | "history" | "cases" | "exit" | "audit";

export function EmployeeProfileWorkspace({ profile, history, documents, canManage, canSeeCases = false, canAudit = false, options }: { profile: EmployeeProfile; history: EmploymentEventRow[]; documents: EmployeeDocumentRow[]; canManage: boolean; canSeeCases?: boolean; canAudit?: boolean; options: Options }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [docs, setDocs] = useState(documents);
  const [uploading, setUploading] = useState(false);
  const [uploadCat, setUploadCat] = useState("OTHER");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const reloadDocs = () => fetch(`/api/employees/${profile.id}/documents`, { cache: "no-store" }).then((r) => r.json()).then((d) => Array.isArray(d) && setDocs(d)).catch(() => undefined);

  async function upload(file: File) {
    setUploading(true);
    try {
      const ct = file.type || "application/octet-stream";
      const res = await fetch(`/api/employees/${profile.id}/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, category: uploadCat, contentType: ct, sizeBytes: file.size }) });
      if (!res.ok) return;
      const { uploadUrl } = (await res.json()) as { uploadUrl: string };
      await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": ct }, body: file });
      await reloadDocs();
    } finally { setUploading(false); }
  }
  async function deleteDoc(docId: string) {
    if (typeof window !== "undefined" && !window.confirm("Delete this document?")) return;
    await fetch(`/api/employees/documents/${docId}`, { method: "DELETE" });
    reloadDocs();
  }
  async function addNote() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/employees/${profile.id}/history`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "NOTE", title: note.trim() }) });
      setNote("");
      router.refresh();
    } finally { setBusy(false); }
  }

  const TabBtn = ({ k, l, n }: { k: Tab; l: string; n?: number }) => (
    <button onClick={() => setTab(k)} className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${tab === k ? "bg-panel text-slate-900 shadow-sm ring-1 ring-hairline" : "text-slate-500 hover:text-slate-800"}`}>{l}{n ? <span className="ml-1.5 text-xs text-slate-400">{n}</span> : null}</button>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/employees" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Directory</Link>
        {canManage ? <button onClick={() => setEditOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"><Pencil className="size-3.5" /> Edit profile</button> : null}
      </div>

      {/* Header */}
      <Card>
        <div className="flex flex-wrap items-center gap-4 p-5">
          <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-brand/10 text-lg font-semibold text-brand ring-1 ring-inset ring-brand/20">{initials(`${profile.firstName} ${profile.lastName}`)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">{profile.firstName} {profile.lastName}</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STAGE[profile.lifecycleStage] ?? "bg-slate-100 text-slate-600 ring-slate-200"}`}>{profile.lifecycleStage.toLowerCase()}</span>
              <span className="rounded-full bg-panel-2 px-2 py-0.5 text-xs text-slate-600">{profile.status.toLowerCase().replace("_", " ")}</span>
            </div>
            <p className="mt-0.5 text-sm text-slate-500">{profile.title ?? profile.designationRef?.title ?? "—"}{profile.departmentRef ? ` · ${profile.departmentRef.name}` : ""}{profile.teamName ? ` · ${profile.teamName}` : ""}</p>
            <p className="mt-0.5 text-xs text-slate-400">{profile.email ?? "no email"}{profile.employeeCode ? ` · ${profile.employeeCode}` : ""}{profile.joinedAt ? ` · joined ${formatDate(profile.joinedAt)}` : ""}</p>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap gap-1 rounded-xl border border-hairline bg-panel-2 p-1">
        <TabBtn k="overview" l="Overview" />
        <TabBtn k="reporting" l="Reporting" n={profile.directReports.length || undefined} />
        <TabBtn k="career" l="Career" />
        {canManage ? <TabBtn k="probation" l="Probation" /> : null}
        <TabBtn k="recognition" l="Recognition" />
        <TabBtn k="remarks" l="Remarks" />
        <TabBtn k="skills" l="Skills" />
        <TabBtn k="certifications" l="Certifications" />
        <TabBtn k="documents" l="Documents" n={docs.length || undefined} />
        <TabBtn k="history" l="History" n={history.length || undefined} />
        {canSeeCases ? <TabBtn k="cases" l="Cases" /> : null}
        {canManage ? <TabBtn k="exit" l="Exit" /> : null}
        {canAudit ? <TabBtn k="audit" l="Audit" /> : null}
      </div>

      {tab === "overview" ? (
        <div className="space-y-4">
          {canManage ? <EmployeeRecommendationsPanel employeeId={profile.id} /> : null}
          <Employee360Panel employeeId={profile.id} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Job details" />
            <CardBody className="grid grid-cols-2 gap-x-6 gap-y-3">
              <Field k="Designation" v={profile.designationRef ? `${profile.designationRef.title}${profile.designationRef.level ? ` · ${profile.designationRef.level}` : ""}` : "—"} />
              <Field k="Title" v={profile.title ?? "—"} />
              <Field k="Department" v={profile.departmentRef?.name ?? "—"} />
              <Field k="Team" v={profile.teamName ?? "—"} />
              <Field k="Employment type" v={profile.employmentType ? profile.employmentType.toLowerCase().replace("_", " ") : "—"} />
              <Field k="Work model" v={workModelLabel(profile.workModel, profile.officeDays)} />
              <Field k="Location" v={profile.location ?? "—"} />
              <Field k="Joined" v={profile.joinedAt ? formatDate(profile.joinedAt) : "—"} />
              <Field k="Employee code" v={profile.employeeCode ?? "—"} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Personal details" />
            <CardBody className="grid grid-cols-2 gap-x-6 gap-y-3">
              <Field k="Work email" v={profile.email ?? "—"} />
              <Field k="Personal email" v={profile.personalEmail ?? "—"} />
              <Field k="Phone" v={profile.phone ?? "—"} />
              <Field k="Date of birth" v={profile.dateOfBirth ? formatDate(profile.dateOfBirth) : "—"} />
              <Field k="Gender" v={profile.gender ?? "—"} />
              <Field k="Address" v={profile.address ?? "—"} full />
              <Field k="Emergency contact" v={profile.emergencyContactName ? `${profile.emergencyContactName}${profile.emergencyContactPhone ? ` · ${profile.emergencyContactPhone}` : ""}` : "—"} full />
            </CardBody>
          </Card>
          </div>
        </div>
      ) : null}

      {tab === "reporting" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Reports to" />
            <CardBody>
              {profile.manager ? (
                <Link href={`/employees/${profile.manager.id}`} className="flex items-center gap-3 rounded-xl border border-hairline p-3 hover:border-brand/40 hover:bg-slate-50">
                  <span className="grid size-9 place-items-center rounded-lg bg-panel-2 text-xs font-semibold text-slate-600">{initials(profile.manager.name)}</span>
                  <span><span className="block text-sm font-medium text-slate-800">{profile.manager.name}</span><span className="block text-xs text-slate-500">{profile.manager.title ?? "Manager"}</span></span>
                </Link>
              ) : <p className="text-sm text-slate-500">No reporting manager set.</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Direct reports" subtitle={`${profile.directReports.length} people`} />
            <ul className="divide-y divide-hairline/60">
              {profile.directReports.length === 0 ? <li className="px-5 py-6 text-center text-sm text-slate-500">No direct reports.</li> : profile.directReports.map((r) => (
                <li key={r.id}><Link href={`/employees/${r.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                  <span className="grid size-8 place-items-center rounded-lg bg-panel-2 text-[11px] font-semibold text-slate-600">{initials(r.name)}</span>
                  <span className="min-w-0"><span className="block truncate text-sm font-medium text-slate-800">{r.name}</span><span className="block text-xs text-slate-500">{r.title ?? "—"}</span></span>
                </Link></li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      {tab === "documents" ? (
        <Card>
          <CardHeader title="Documents" subtitle="Offer letters, contracts, ID & compliance" action={canManage ? (
            <div className="flex items-center gap-2">
              <select value={uploadCat} onChange={(e) => setUploadCat(e.target.value)} className="rounded-lg border border-hairline bg-panel px-2 py-1.5 text-xs text-slate-700">{DOC_CATS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-soft">
                <Upload className="size-3.5" /> {uploading ? "Uploading…" : "Upload"}
                <input type="file" className="hidden" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
              </label>
            </div>
          ) : undefined} />
          <ul className="divide-y divide-hairline/60">
            {docs.length === 0 ? <li className="px-5 py-8 text-center text-sm text-slate-500">No documents uploaded.</li> : docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-panel-2 text-slate-500"><FileText className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800">{d.fileName}</span>
                  <span className="block text-xs text-slate-400">{DOC_CATS.find((c) => c.key === d.category)?.label ?? d.category} · {fmtBytes(d.sizeBytes)} · {formatDate(d.createdAt)}</span>
                </span>
                <a href={d.viewUrl} target="_blank" rel="noreferrer" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="View / download"><Download className="size-4" /></a>
                {canManage ? <button onClick={() => deleteDoc(d.id)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600" title="Delete"><Trash2 className="size-4" /></button> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {tab === "history" ? (
        <Card>
          <CardHeader title="Employment history" subtitle="Joining, promotions, transfers & notes" />
          <CardBody>
            {canManage ? (
              <div className="mb-4 flex gap-2">
                <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addNote(); }} placeholder="Add a note (e.g. Received award, completed training)…" className={input} />
                <button onClick={addNote} disabled={busy || !note.trim()} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-hairline bg-panel px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Plus className="size-4" /> Add</button>
              </div>
            ) : null}
            <ol className="relative space-y-4 border-l border-hairline pl-5">
              {history.length === 0 ? <li className="text-sm text-slate-500">No history yet.</li> : history.map((e) => (
                <li key={e.id} className="relative">
                  <span className={`absolute -left-[26px] top-1 size-3 rounded-full ring-2 ring-panel ${EVENT_TONE[e.type] ?? "bg-slate-400"}`} />
                  <p className="text-sm font-medium text-slate-800">{e.title}</p>
                  {e.detail ? <p className="text-xs text-slate-500">{e.detail}</p> : null}
                  <p className="text-xs text-slate-400">{e.type.toLowerCase().replace("_", " ")} · {formatDate(e.effectiveDate)}</p>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      ) : null}

      {tab === "career" ? <EmployeeCareerPanel employeeId={profile.id} canManage={canManage} options={options} /> : null}
      {tab === "probation" && canManage ? <EmployeeProbationPanel employeeId={profile.id} canManage={canManage} /> : null}
      {tab === "recognition" ? <EmployeeRecognitionPanel employeeId={profile.id} canManage={canManage} /> : null}
      {tab === "remarks" ? <EmployeeRemarksPanel employeeId={profile.id} canManage={canManage} /> : null}
      {tab === "skills" ? <EmployeeSkillsPanel employeeId={profile.id} canManage={canManage} /> : null}
      {tab === "certifications" ? <EmployeeCertificationsPanel employeeId={profile.id} canManage={canManage} /> : null}

      {tab === "cases" && canSeeCases ? <EmployeeCasesPanel employeeId={profile.id} /> : null}
      {tab === "exit" && canManage ? <EmployeeExitPanel employeeId={profile.id} canManage={canManage} /> : null}
      {tab === "audit" && canAudit ? <EmployeeAuditPanel employeeId={profile.id} /> : null}

      {editOpen ? <EditModal profile={profile} options={options} onClose={() => setEditOpen(false)} /> : null}
    </div>
  );
}

function Field({ k, v, full }: { k: string; v: string; full?: boolean }) {
  return <div className={full ? "col-span-2" : ""}><dt className={label}>{k}</dt><dd className="text-sm text-slate-800">{v}</dd></div>;
}

function EditModal({ profile, options, onClose }: { profile: EmployeeProfile; options: Options; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({
    firstName: profile.firstName, lastName: profile.lastName, email: profile.email ?? "", personalEmail: profile.personalEmail ?? "", employeeCode: profile.employeeCode ?? "",
    title: profile.title ?? "", designationId: profile.designationId ?? "", departmentId: profile.departmentId ?? "", teamId: profile.teamId ?? "",
    shiftId: profile.shiftId ?? "", rotationId: profile.rotationId ?? "", managerId: profile.managerId ?? "", status: profile.status, employmentType: profile.employmentType ?? "",
    workModel: profile.workModel ?? "",
    joinedAt: profile.joinedAt?.slice(0, 10) ?? "", phone: profile.phone ?? "", dateOfBirth: profile.dateOfBirth?.slice(0, 10) ?? "",
    gender: profile.gender ?? "", location: profile.location ?? "", address: profile.address ?? "",
    emergencyContactName: profile.emergencyContactName ?? "", emergencyContactPhone: profile.emergencyContactPhone ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // On-site days for a HYBRID work model (weekday numbers, 0=Sun). Only sent/used
  // when workModel === "HYBRID"; the backend clears them for WFO/WFH.
  const [officeDays, setOfficeDays] = useState<number[]>(profile.officeDays ?? []);
  // Set after a work-email change: the new sign-in credentials to hand over.
  const [issued, setIssued] = useState<{ email: string; tempPassword: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const toggleOfficeDay = (d: number) => setOfficeDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));

  const workEmailChanged = (f.email.trim() || null) !== (profile.email ?? null);

  async function save() {
    setBusy(true); setError(null);
    const payload = {
      firstName: f.firstName.trim(), lastName: f.lastName.trim(), email: f.email.trim() || null, personalEmail: f.personalEmail.trim() || null, employeeCode: f.employeeCode.trim() || null,
      title: f.title.trim() || null, designationId: f.designationId || null, departmentId: f.departmentId || null, teamId: f.teamId || null,
      shiftId: f.shiftId || null, rotationId: f.rotationId || null, managerId: f.managerId || null, status: f.status, employmentType: f.employmentType || null,
      workModel: f.workModel || null, officeDays: f.workModel === "HYBRID" ? officeDays : [],
      joinedAt: toIso(f.joinedAt), phone: f.phone.trim() || null, dateOfBirth: toIso(f.dateOfBirth), gender: f.gender.trim() || null,
      location: f.location.trim() || null, address: f.address.trim() || null, emergencyContactName: f.emergencyContactName.trim() || null, emergencyContactPhone: f.emergencyContactPhone.trim() || null,
    };
    try {
      const res = await fetch(`/api/employees/${profile.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = (await res.json().catch(() => ({}))) as { error?: string; issuedTempPassword?: string };
      if (!res.ok) { setError(d.error ?? "Could not save."); return; }
      // A work-email change re-issues login credentials — show them once so the
      // admin can pass them on, then close on acknowledgement.
      if (d.issuedTempPassword) {
        setIssued({ email: payload.email ?? "", tempPassword: d.issuedTempPassword });
        router.refresh();
        return;
      }
      onClose();
      router.refresh();
    } finally { setBusy(false); }
  }

  if (issued) {
    return (
      <Modal open onClose={onClose} title="New sign-in details" size="lg">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">The work email was changed, so this person now signs in with new credentials. Share these — they'll be asked to set a new password on first sign-in.</p>
          <div className="rounded-lg border border-hairline bg-slate-50 p-3 text-sm">
            <div className="flex justify-between gap-4 py-1"><span className="text-slate-500">Work email</span><span className="font-medium text-slate-900">{issued.email}</span></div>
            <div className="flex justify-between gap-4 py-1"><span className="text-slate-500">Temporary password</span><span className="font-mono font-medium text-slate-900">{issued.tempPassword}</span></div>
          </div>
        </div>
        <div className="mt-4 flex justify-end border-t border-hairline pt-4">
          <button onClick={onClose} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft">Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Edit employee" size="lg">
      <div className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Identity</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={label}>First name</label><input className={input} value={f.firstName} onChange={set("firstName")} /></div>
          <div><label className={label}>Last name</label><input className={input} value={f.lastName} onChange={set("lastName")} /></div>
          <div className="col-span-2">
            <label className={label}>Work email <span className="font-normal text-slate-400">· used to sign in</span></label>
            <input className={input} value={f.email} onChange={set("email")} />
            {workEmailChanged ? (
              <p className="mt-1 text-xs text-amber-600">Changing this changes how they sign in — they'll get a new temporary password to log in with.</p>
            ) : null}
          </div>
          <div><label className={label}>Employee code</label><input className={input} value={f.employeeCode} onChange={set("employeeCode")} /></div>
        </div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Job</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={label}>Title</label><input className={input} value={f.title} onChange={set("title")} /></div>
          <div><label className={label}>Designation</label><select className={input} value={f.designationId} onChange={set("designationId")}><option value="">None</option>{options.designations.map((d) => <option key={d.id} value={d.id}>{d.title}{d.level ? ` · ${d.level}` : ""}</option>)}</select></div>
          <div><label className={label}>Department</label><select className={input} value={f.departmentId} onChange={set("departmentId")}><option value="">None</option>{options.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          <div><label className={label}>Team</label><select className={input} value={f.teamId} onChange={set("teamId")}><option value="">None</option>{options.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          <div><label className={label}>Reporting manager</label><select className={input} value={f.managerId} onChange={set("managerId")}><option value="">None</option>{options.managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          <div><label className={label}>Shift</label><select className={input} value={f.shiftId} onChange={set("shiftId")}><option value="">Default</option>{options.shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><label className={label}>Shift rotation <span className="font-normal text-slate-400">· overrides the fixed shift</span></label><select className={input} value={f.rotationId} onChange={set("rotationId")}><option value="">None</option>{options.rotations.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
          <div><label className={label}>Employment type</label><select className={input} value={f.employmentType} onChange={set("employmentType")}><option value="">—</option>{["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"].map((t) => <option key={t} value={t}>{t.toLowerCase().replace("_", " ")}</option>)}</select></div>
          <div><label className={label}>Work model <span className="font-normal text-slate-400">· defaults to the org policy</span></label><select className={input} value={f.workModel} onChange={set("workModel")}><option value="">Org default</option><option value="WFO">On-site (WFO)</option><option value="WFH">Remote (WFH)</option><option value="HYBRID">Hybrid</option></select></div>
          {f.workModel === "HYBRID" ? (
            <div className="sm:col-span-2">
              <label className={label}>On-site days</label>
              <div className="flex flex-wrap gap-1.5">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                  <button key={d} type="button" onClick={() => toggleOfficeDay(i)} className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${officeDays.includes(i) ? "border-brand bg-brand text-white" : "border-hairline bg-panel text-slate-600 hover:bg-slate-50"}`}>{d}</button>
                ))}
              </div>
            </div>
          ) : null}
          <div><label className={label}>Status</label><select className={input} value={f.status} onChange={set("status")}>{["ACTIVE", "ON_LEAVE", "NOTICE_PERIOD", "SUSPENDED"].map((s) => <option key={s} value={s}>{s.toLowerCase().replace("_", " ")}</option>)}</select></div>
          <div><label className={label}>Joined</label><input type="date" className={input} value={f.joinedAt} onChange={set("joinedAt")} /></div>
        </div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Personal</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className={label}>Personal email <span className="font-normal text-slate-400">· personal contact, not used to sign in</span></label><input className={input} value={f.personalEmail} onChange={set("personalEmail")} /></div>
          <div><label className={label}>Phone</label><input className={input} value={f.phone} onChange={set("phone")} /></div>
          <div><label className={label}>Date of birth</label><input type="date" className={input} value={f.dateOfBirth} onChange={set("dateOfBirth")} /></div>
          <div><label className={label}>Gender</label><input className={input} value={f.gender} onChange={set("gender")} /></div>
          <div><label className={label}>Location</label><input className={input} value={f.location} onChange={set("location")} /></div>
          <div className="col-span-2"><label className={label}>Address</label><input className={input} value={f.address} onChange={set("address")} /></div>
          <div><label className={label}>Emergency contact</label><input className={input} value={f.emergencyContactName} onChange={set("emergencyContactName")} /></div>
          <div><label className={label}>Emergency phone</label><input className={input} value={f.emergencyContactPhone} onChange={set("emergencyContactPhone")} /></div>
        </div>
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      </div>
      <div className="mt-4 flex justify-end gap-2 border-t border-hairline pt-4">
        <button onClick={onClose} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
        <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">{busy ? "Saving…" : "Save changes"}</button>
      </div>
    </Modal>
  );
}
