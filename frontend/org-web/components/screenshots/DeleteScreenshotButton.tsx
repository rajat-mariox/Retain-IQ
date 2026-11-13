"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

/** Owner-only delete (the API enforces screenshots.delete; this just renders for Owners). */
export function DeleteScreenshotButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/storage/screenshots/${id}`, { method: "DELETE" });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not delete the screenshot.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setError(null); setOpen(true); }}
        aria-label="Delete screenshot"
        className="absolute right-2 top-2 grid size-8 place-items-center rounded-lg bg-slate-900/60 text-white opacity-0 backdrop-blur transition-opacity hover:bg-rose-600/80 group-hover:opacity-100"
      >
        <Trash2 className="size-4" />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Delete screenshot" size="sm">
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-rose-500/10 text-rose-600">
              <AlertTriangle className="size-5" />
            </span>
            <p className="text-sm text-slate-600">Delete this screenshot?</p>
          </div>
          {error ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900">
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Delete
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
