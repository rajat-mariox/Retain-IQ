"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, ClipboardList, MinusCircle, Plus, Trash2, Users } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/cn";
import { useSubmitLock } from "@/lib/hooks";
import type { OnbItem, OnbJourneyDetail, OnbOverview, OnbTask, OnbTemplate, OnbTemplateSummary } from "@/lib/api";

type Tab = "people" | "templates";

const CATEGORIES = ["TASK", "DOCUMENT", "POLICY", "ACCESS", "TRAINING"] as const;
const ASSIGNEES = ["HR", "IT", "MANAGER", "EMPLOYEE"] as const;
const CAT_TINT: Record<string, string> = {
  TASK: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
  DOCUMENT: "bg-sky-500/10 text-sky-700 ring-sky-600/20",
  POLICY: "bg-violet-500/10 text-violet-700 ring-violet-600/20",
  ACCESS: "bg-amber-500/10 text-amber-700 ring-amber-600/20",
  TRAINING: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
};

const btn = "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors";
const btnPrimary = cn(btn, "bg-slate-900 text-white hover:bg-slate-700");
const btnGhost = cn(btn, "border border-hairline bg-panel text-slate-700 hover:bg-panel-2");
const input = "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400";
const label = "text-xs font-medium text-slate-600";

function pill(map: Record<string, string>, key: string) {
  return cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", map[key] ?? "bg-panel-2 text-slate-600 ring-hairline");
}
async function call(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  const res = await fetch(url, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, data };
  return { ok: false, error: (data as { error?: string }).error ?? "Something went wrong." };
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
      <div className={cn("h-full rounded-full", percent === 100 ? "bg-emerald-500" : "bg-slate-900")} style={{ width: `${percent}%` }} />
    </div>
  );
}

export function OnboardingWorkspace({ overview, templates }: { overview: OnbOverview; templates: OnbTemplateSummary[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("people");
  const [openEmployee, setOpenEmployee] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { k: "Onboarding", v: overview.counts.onboarding },
          { k: "Not started", v: overview.counts.notStarted },
          { k: "In progress", v: overview.counts.inProgress },
          { k: "Completed", v: overview.counts.completed },
        ].map((t) => (
          <Card key={t.k}>
            <CardBody className="p-4">
              <p className="text-xs text-slate-500">{t.k}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{t.v}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([
          ["people", "People", Users],
          ["templates", "Checklist templates", ClipboardList],
        ] as const).map(([key, text, Icon]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={cn(btn, "border", tab === key ? "border-slate-900 bg-slate-900 text-white" : "border-hairline bg-panel text-slate-600 hover:bg-panel-2")}>
            <Icon className="size-3.5" /> {text}
          </button>
        ))}
      </div>

      {tab === "people" ? (
        <PeopleTab overview={overview} templates={templates} onOpen={setOpenEmployee} onChanged={() => router.refresh()} />
      ) : (
        <TemplatesTab templates={templates} onChanged={() => router.refresh()} />
      )}

      {openEmployee && <JourneyModal employeeId={openEmployee} onClose={() => setOpenEmployee(null)} onChanged={() => router.refresh()} />}
    </div>
  );
}

/* -------------------------------- People -------------------------------- */
function PeopleTab({ overview, templates, onOpen, onChanged }: { overview: OnbOverview; templates: OnbTemplateSummary[]; onOpen: (id: string) => void; onChanged: () => void }) {
  const [starting, setStarting] = useState<string | null>(null);
  async function start(employeeId: string) {
    setStarting(employeeId);
    const res = await call(`/api/onboarding/employees/${employeeId}/start`, "POST", {});
    setStarting(null);
    if (res.ok) { onChanged(); onOpen(employeeId); }
    else alert(res.error);
  }
  return (
    <Card>
      <CardHeader title="New hires" subtitle="Everyone currently in onboarding" action={<span className="text-xs text-slate-500">{templates.length} template{templates.length === 1 ? "" : "s"}</span>} />
      <CardBody className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3">Employee</th>
              <th className="px-5 py-3">Joined</th>
              <th className="w-64 px-5 py-3">Progress</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {overview.rows.map((r) => (
              <tr key={r.employeeId} className="border-b border-hairline/60 last:border-0">
                <td className="px-5 py-3">
                  <p className="font-medium text-slate-900">{r.name}</p>
                  <p className="text-xs text-slate-500">{r.title ?? "—"}</p>
                </td>
                <td className="px-5 py-3 text-slate-600">{r.joinedAt ? new Date(r.joinedAt).toLocaleDateString() : "—"}</td>
                <td className="px-5 py-3">
                  {r.journey ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>{r.journey.done}/{r.journey.total} done</span>
                        <span>{r.journey.percent}%{r.journey.status === "COMPLETED" ? " · complete" : ""}</span>
                      </div>
                      <ProgressBar percent={r.journey.percent} />
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">Not started</span>
                  )}
                </td>
                <td className="px-5 py-3 text-right">
                  {r.journey ? (
                    <button type="button" className={btnGhost} onClick={() => onOpen(r.employeeId)}>Open checklist</button>
                  ) : (
                    <button type="button" className={btnPrimary} disabled={starting === r.employeeId} onClick={() => start(r.employeeId)}>{starting === r.employeeId ? "Starting…" : "Start onboarding"}</button>
                  )}
                </td>
              </tr>
            ))}
            {overview.rows.length === 0 && (
              <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-400">No one is onboarding right now. New hires appear here automatically.</td></tr>
            )}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}

/* ----------------------------- Journey modal ---------------------------- */
function JourneyModal({ employeeId, onClose, onChanged }: { employeeId: string; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<OnbJourneyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  // The status circle cycles PENDING→DONE→SKIPPED; a double-click would advance
  // it twice and skip a state, so serialise the toggle.
  const { busy: cycling, run } = useSubmitLock();

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/onboarding/employees/${employeeId}`, { cache: "no-store" });
    if (res.ok) setDetail((await res.json()) as OnbJourneyDetail);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [employeeId]);

  async function cycle(task: OnbTask) {
    await run(async () => {
      const next = task.status === "PENDING" ? "DONE" : task.status === "DONE" ? "SKIPPED" : "PENDING";
      const res = await call(`/api/onboarding/tasks/${task.id}`, "PATCH", { status: next });
      if (res.ok) { await load(); onChanged(); } else alert(res.error);
    });
  }
  async function removeTask(task: OnbTask) {
    if (!confirm(`Remove "${task.title}"?`)) return;
    const res = await call(`/api/onboarding/tasks/${task.id}`, "DELETE");
    if (res.ok) { await load(); onChanged(); } else alert(res.error);
  }

  const j = detail?.journey;
  return (
    <Modal open onClose={onClose} title={detail ? `Onboarding · ${detail.employee.name}` : "Onboarding"} size="lg">
      {loading && <p className="py-8 text-center text-sm text-slate-400">Loading…</p>}
      {detail && !j && <p className="py-8 text-center text-sm text-slate-400">No onboarding journey yet.</p>}
      {detail && j && (
        <div className="space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>{detail.employee.title ?? "—"}{j.templateName ? ` · ${j.templateName}` : ""}</span>
              <span>{j.done}/{j.total} done · {j.percent}%</span>
            </div>
            <ProgressBar percent={j.percent} />
            {j.status === "COMPLETED" && <p className="mt-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700">All required tasks complete — onboarding finished.</p>}
          </div>

          <div className="space-y-2">
            {j.tasks.map((t) => (
              <div key={t.id} className="flex items-start gap-3 rounded-lg border border-hairline bg-panel px-3 py-2">
                <button type="button" disabled={cycling} onClick={() => cycle(t)} className="mt-0.5 shrink-0 disabled:opacity-60" title="Toggle status">
                  {t.status === "DONE" ? <CheckCircle2 className="size-5 text-emerald-500" /> : t.status === "SKIPPED" ? <MinusCircle className="size-5 text-slate-300" /> : <Circle className="size-5 text-slate-300" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium", t.status === "DONE" ? "text-slate-400 line-through" : t.status === "SKIPPED" ? "text-slate-400" : "text-slate-900")}>{t.title}</p>
                  {t.description && <p className="text-xs text-slate-500">{t.description}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className={pill(CAT_TINT, t.category)}>{t.category.toLowerCase()}</span>
                    <span className="text-[11px] text-slate-400">{t.assignee.toLowerCase()}</span>
                    {t.required && <span className="text-[11px] text-rose-400">required</span>}
                  </div>
                </div>
                <button type="button" onClick={() => removeTask(t)} className="mt-0.5 shrink-0 text-slate-300 hover:text-rose-500" title="Remove">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>

          {adding ? (
            <AddTaskInline journeyId={j.id} onDone={() => { setAdding(false); load(); onChanged(); }} onCancel={() => setAdding(false)} />
          ) : (
            <button type="button" className={btnGhost} onClick={() => setAdding(true)}><Plus className="size-3.5" /> Add task</button>
          )}
        </div>
      )}
    </Modal>
  );
}

function AddTaskInline({ journeyId, onDone, onCancel }: { journeyId: string; onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("TASK");
  const [assignee, setAssignee] = useState<string>("HR");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!title.trim()) return;
    setBusy(true);
    const res = await call(`/api/onboarding/journeys/${journeyId}/tasks`, "POST", { title: title.trim(), category, assignee, required: true });
    setBusy(false);
    if (res.ok) onDone(); else alert(res.error);
  }
  return (
    <div className="space-y-2 rounded-lg border border-hairline bg-panel-2 p-3">
      <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" autoFocus />
      <div className="flex gap-2">
        <select className={input} value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}</select>
        <select className={input} value={assignee} onChange={(e) => setAssignee(e.target.value)}>{ASSIGNEES.map((a) => <option key={a} value={a}>{a.toLowerCase()}</option>)}</select>
        <button type="button" className={btnPrimary} disabled={busy} onClick={submit}>Add</button>
        <button type="button" className={btnGhost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/* ------------------------------ Templates ------------------------------- */
function TemplatesTab({ templates, onChanged }: { templates: OnbTemplateSummary[]; onChanged: () => void }) {
  const [openNew, setOpenNew] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const { busy, run } = useSubmitLock();
  async function makeDefault(id: string) {
    await run(async () => {
      const res = await call(`/api/onboarding/templates/${id}`, "PATCH", { isDefault: true });
      if (res.ok) onChanged(); else alert(res.error);
    });
  }
  async function remove(t: OnbTemplateSummary) {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    const res = await call(`/api/onboarding/templates/${t.id}`, "DELETE");
    if (res.ok) onChanged(); else alert(res.error);
  }
  return (
    <Card>
      <CardHeader title="Checklist templates" subtitle="Reusable onboarding checklists — the default is applied to new hires" action={<button type="button" className={btnPrimary} onClick={() => setOpenNew(true)}><Plus className="size-3.5" /> New template</button>} />
      <CardBody className="space-y-2">
        {templates.map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded-lg border border-hairline bg-panel px-4 py-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-slate-900">{t.name}{t.isDefault && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">default</span>}</p>
              <p className="text-xs text-slate-500">{t.items} item{t.items === 1 ? "" : "s"}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className={btnGhost} onClick={() => setEditId(t.id)}>Edit items</button>
              {!t.isDefault && <button type="button" disabled={busy} className={cn(btnGhost, "disabled:opacity-50")} onClick={() => makeDefault(t.id)}>Set default</button>}
              {!t.isDefault && <button type="button" className={cn(btn, "text-rose-500 hover:bg-rose-50")} onClick={() => remove(t)}><Trash2 className="size-3.5" /></button>}
            </div>
          </div>
        ))}
        {templates.length === 0 && <p className="py-8 text-center text-sm text-slate-400">No templates yet. Create one — seed it with a standard checklist to start fast.</p>}
      </CardBody>
      {openNew && <NewTemplateModal onClose={() => setOpenNew(false)} onSaved={() => { setOpenNew(false); onChanged(); }} />}
      {editId && <TemplateItemsModal templateId={editId} onClose={() => setEditId(null)} onChanged={onChanged} />}
    </Card>
  );
}

function NewTemplateModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [seedDefault, setSeedDefault] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    if (!name.trim()) return setErr("Name is required.");
    setBusy(true); setErr(null);
    const res = await call("/api/onboarding/templates", "POST", { name: name.trim(), seedDefault });
    setBusy(false);
    if (res.ok) onSaved(); else setErr(res.error ?? "Could not save.");
  }
  return (
    <Modal open onClose={onClose} title="New checklist template" size="sm">
      <div className="space-y-3">
        {err && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700">{err}</p>}
        <div><label className={label}>Name</label><input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Engineering onboarding" autoFocus /></div>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={seedDefault} onChange={(e) => setSeedDefault(e.target.checked)} /> Pre-fill with a standard checklist</label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={submit}>{busy ? "Saving…" : "Create"}</button>
        </div>
      </div>
    </Modal>
  );
}

function TemplateItemsModal({ templateId, onClose, onChanged }: { templateId: string; onClose: () => void; onChanged: () => void }) {
  const [tpl, setTpl] = useState<OnbTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/onboarding/templates/${templateId}`, { cache: "no-store" });
    if (res.ok) setTpl((await res.json()) as OnbTemplate);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [templateId]);

  async function removeItem(item: OnbItem) {
    const res = await call(`/api/onboarding/items/${item.id}`, "DELETE");
    if (res.ok) { await load(); onChanged(); } else alert(res.error);
  }

  return (
    <Modal open onClose={onClose} title={tpl ? `Items · ${tpl.name}` : "Items"} size="lg">
      {loading && <p className="py-8 text-center text-sm text-slate-400">Loading…</p>}
      {tpl && (
        <div className="space-y-3">
          <div className="space-y-2">
            {tpl.items.map((it) => (
              <div key={it.id} className="flex items-start justify-between gap-3 rounded-lg border border-hairline bg-panel px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{it.title}</p>
                  {it.description && <p className="text-xs text-slate-500">{it.description}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className={pill(CAT_TINT, it.category)}>{it.category.toLowerCase()}</span>
                    <span className="text-[11px] text-slate-400">{it.assignee.toLowerCase()}</span>
                    {it.required && <span className="text-[11px] text-rose-400">required</span>}
                  </div>
                </div>
                <button type="button" onClick={() => removeItem(it)} className="shrink-0 text-slate-300 hover:text-rose-500"><Trash2 className="size-4" /></button>
              </div>
            ))}
            {tpl.items.length === 0 && <p className="py-4 text-center text-sm text-slate-400">No items yet.</p>}
          </div>
          {adding ? (
            <AddItemInline templateId={templateId} onDone={() => { setAdding(false); load(); onChanged(); }} onCancel={() => setAdding(false)} />
          ) : (
            <button type="button" className={btnGhost} onClick={() => setAdding(true)}><Plus className="size-3.5" /> Add item</button>
          )}
        </div>
      )}
    </Modal>
  );
}

function AddItemInline({ templateId, onDone, onCancel }: { templateId: string; onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("TASK");
  const [assignee, setAssignee] = useState<string>("HR");
  const [required, setRequired] = useState(true);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!title.trim()) return;
    setBusy(true);
    const res = await call(`/api/onboarding/templates/${templateId}/items`, "POST", { title: title.trim(), category, assignee, required });
    setBusy(false);
    if (res.ok) onDone(); else alert(res.error);
  }
  return (
    <div className="space-y-2 rounded-lg border border-hairline bg-panel-2 p-3">
      <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Item title" autoFocus />
      <div className="flex flex-wrap items-center gap-2">
        <select className={cn(input, "w-auto")} value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}</select>
        <select className={cn(input, "w-auto")} value={assignee} onChange={(e) => setAssignee(e.target.value)}>{ASSIGNEES.map((a) => <option key={a} value={a}>{a.toLowerCase()}</option>)}</select>
        <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> required</label>
        <button type="button" className={btnPrimary} disabled={busy} onClick={submit}>Add</button>
        <button type="button" className={btnGhost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
