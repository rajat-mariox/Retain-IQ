"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { ScreenshotThumb } from "@/components/screenshots/ScreenshotThumb";
import { DeleteScreenshotButton } from "@/components/screenshots/DeleteScreenshotButton";
import { LocalTime } from "@/components/ui/LocalTime";
import { formatBytes } from "@/lib/format";

export interface GridShot {
  id: string;
  viewUrl: string;
  capturedAt: string;
  sizeBytes: number;
  employeeName?: string;
}

/**
 * Screenshot grid with an in-page preview (lightbox). Clicking a thumbnail opens
 * a full-size overlay on the SAME page — no navigating away to the raw image.
 * Arrow keys / on-screen arrows step through the page's screenshots; Esc or a
 * backdrop click closes. `showDelete` renders the Owner-only delete affordance.
 */
export function ScreenshotGrid({ shots, showDelete = false }: { shots: GridShot[]; showDelete?: boolean }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const isOpen = openIndex !== null;

  const close = useCallback(() => setOpenIndex(null), []);
  const step = useCallback(
    (dir: 1 | -1) =>
      setOpenIndex((i) => {
        if (i === null || shots.length === 0) return i;
        return (i + dir + shots.length) % shots.length;
      }),
    [shots.length],
  );

  // Keyboard nav + body-scroll lock while the preview is open.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, close, step]);

  const active = openIndex !== null ? shots[openIndex] : null;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {shots.map((shot, i) => (
          <div key={shot.id} className="group relative overflow-hidden rounded-xl border border-hairline bg-panel">
            <button
              type="button"
              onClick={() => setOpenIndex(i)}
              aria-label="Open preview"
              className="block aspect-video w-full bg-panel-2 outline-none ring-brand/50 focus-visible:ring-2"
            >
              <ScreenshotThumb src={shot.viewUrl} alt={`Screenshot from ${shot.capturedAt.slice(0, 10)}`} />
            </button>
            {showDelete ? <DeleteScreenshotButton id={shot.id} /> : null}
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] text-slate-500">
              <span className="truncate">
                <LocalTime iso={shot.capturedAt} mode="datetime" />
              </span>
              <span className="shrink-0 tabular-nums">{formatBytes(shot.sizeBytes)}</span>
            </div>
          </div>
        ))}
      </div>

      {active ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4 sm:p-8 bg-slate-950/70 backdrop-blur-sm [animation:lbFade_.18s_ease-out]"
          role="dialog"
          aria-modal="true"
          onClick={close}
        >
          {/* Contained preview card (not full-screen) with a pop-in motion. */}
          <div
            className="relative flex w-full max-w-4xl max-h-[85vh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl [animation:lbPop_.2s_cubic-bezier(0.16,1,0.3,1)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header: caption + prominent close */}
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-sm text-white/70">
              <div className="min-w-0 truncate">
                {active.employeeName ? <span className="font-medium text-white">{active.employeeName} · </span> : null}
                <LocalTime iso={active.capturedAt} mode="datetime" />
                <span className="ml-2 text-white/40">{openIndex! + 1} / {shots.length}</span>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close preview"
                className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-slate-900 shadow-md transition-transform hover:scale-105 hover:bg-slate-100"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Image stage */}
            <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-slate-950 p-3">
              {shots.length > 1 ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); step(-1); }}
                  aria-label="Previous"
                  className="absolute left-3 z-10 grid size-10 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/30"
                >
                  <ChevronLeft className="size-5" />
                </button>
              ) : null}

              {/* eslint-disable-next-line @next/next/no-img-element -- presigned S3/MinIO URL */}
              <img
                key={active.id}
                src={active.viewUrl}
                alt="Screenshot preview"
                className="max-h-[70vh] max-w-full rounded-lg object-contain [animation:lbSwap_.22s_ease-out]"
              />

              {shots.length > 1 ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); step(1); }}
                  aria-label="Next"
                  className="absolute right-3 z-10 grid size-10 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/30"
                >
                  <ChevronRight className="size-5" />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
