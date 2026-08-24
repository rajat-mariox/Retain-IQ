"use client";

import { useEffect, useState } from "react";
import { Paperclip, Loader2 } from "lucide-react";

interface Attachment {
  id: string;
  fileName: string;
  sizeBytes: number;
  contentType: string;
  viewUrl: string;
}

/**
 * Lazily loads and renders a leave request's supporting documents as clickable
 * chips (each opens its short-lived presigned view URL). Shown in the requests and
 * approval tables so an approver can review the evidence inline. `canDelete` lets
 * the request's owner remove an attachment.
 */
export function AttachmentLinks({ requestId, canDelete = false }: { requestId: string; canDelete?: boolean }) {
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/leave/requests/${requestId}/attachments`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (alive) setItems(Array.isArray(d) ? d : []); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [requestId]);

  async function remove(attId: string) {
    setBusy(true);
    try {
      await fetch(`/api/leave/requests/${requestId}/attachments/${attId}/delete`, { method: "POST" });
      setItems((prev) => (prev ?? []).filter((a) => a.id !== attId));
    } finally {
      setBusy(false);
    }
  }

  if (items === null) return <span className="text-xs text-slate-300">…</span>;
  if (items.length === 0) return <span className="text-xs text-slate-300">—</span>;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((a) => (
        <span key={a.id} className="inline-flex items-center gap-1 rounded-md bg-panel-2 px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-inset ring-hairline">
          <a href={a.viewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-brand" title={a.fileName}>
            <Paperclip className="size-3" />
            <span className="max-w-[120px] truncate">{a.fileName}</span>
          </a>
          {canDelete ? (
            <button type="button" onClick={() => remove(a.id)} disabled={busy} className="text-slate-400 hover:text-rose-600 disabled:opacity-50" aria-label="Remove">
              {busy ? <Loader2 className="size-3 animate-spin" /> : "×"}
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}
