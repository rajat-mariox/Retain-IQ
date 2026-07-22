"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TaskComment } from "@/lib/api";
import { LocalTime } from "@/components/ui/LocalTime";

const STATUSES = [
  { key: "TODO", label: "To do" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "IN_REVIEW", label: "In review" },
  { key: "DONE", label: "Done" },
];

const initials = (name: string) => name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/**
 * State picker on the task page. Available to a project manager and to the
 * assignee (who may move their own task but not edit anything else).
 */
export function TaskStatusControl({ taskId, status, canChange }: { taskId: string; status: string; canChange: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: string) {
    if (next === value) return;
    const prev = value;
    setValue(next);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        setValue(prev);
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "We couldn't change the state. Please try again.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!canChange) {
    return <span className="text-sm font-medium text-slate-800">{STATUSES.find((s) => s.key === value)?.label ?? value}</span>;
  }

  return (
    <div>
      <select
        aria-label="State"
        value={value}
        disabled={busy}
        onChange={(e) => void change(e.target.value)}
        className="rounded-lg border border-hairline bg-panel px-3 py-1.5 text-sm font-medium text-slate-900 focus:border-brand focus:outline-none disabled:opacity-60"
      >
        {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}

/**
 * Description with inline editing. Open to a project manager and to the assignee,
 * who may write up their own work (the backend allows status + description for them).
 */
export function TaskDescription({ taskId, description, canEdit }: { taskId: string; description: string | null; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: value.trim() || null }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "We couldn't save the description. Please try again.");
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-700">Description</h2>
          {canEdit ? (
            <button onClick={() => { setValue(description ?? ""); setEditing(true); }} className="text-sm font-medium text-brand hover:underline">
              {description ? "Edit" : "Add description"}
            </button>
          ) : null}
        </div>
        {description ? (
          <p className="whitespace-pre-wrap rounded-xl border border-hairline bg-panel px-4 py-3 text-sm text-slate-700">{description}</p>
        ) : (
          <p className="rounded-xl border border-dashed border-hairline px-4 py-3 text-sm text-slate-400">No description yet.</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Description</h2>
      <textarea
        rows={6}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="What needs doing? Add any detail that helps."
        className="w-full resize-y rounded-xl border border-hairline bg-panel px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none"
      />
      {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
      <div className="mt-2 flex justify-end gap-2">
        <button onClick={() => { setEditing(false); setError(null); }} className="rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
        <button onClick={() => void save()} disabled={busy} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

/** The task's discussion thread plus the composer. */
export function TaskDiscussion({ taskId, comments }: { taskId: string; comments: TaskComment[] }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "We couldn't post your comment. Please try again.");
        return;
      }
      setBody("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Discussion</h2>

      {comments.length > 0 ? (
        <ul className="mb-4 space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-panel-2 text-[11px] font-semibold text-slate-600">
                {initials(c.authorName)}
              </span>
              <div className="min-w-0 flex-1 rounded-xl border border-hairline bg-panel px-3.5 py-2.5">
                <p className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-slate-400">
                  <span className="font-medium text-slate-700">{c.authorName}</span>
                  <LocalTime iso={c.createdAt} mode="datetime" />
                </p>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-slate-400">No comments yet — start the discussion.</p>
      )}

      <div className="rounded-xl border border-hairline bg-panel p-3">
        <textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment…"
          className="w-full resize-y rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none"
        />
        {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
        <div className="mt-2 flex justify-end">
          <button
            onClick={() => void post()}
            disabled={busy || !body.trim()}
            className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60"
          >
            {busy ? "Posting…" : "Comment"}
          </button>
        </div>
      </div>
    </div>
  );
}
