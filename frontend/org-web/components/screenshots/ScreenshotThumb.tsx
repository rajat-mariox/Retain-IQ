"use client";

import { useEffect, useRef, useState } from "react";
import { ImageOff } from "lucide-react";

type Status = "loading" | "loaded" | "error";

/**
 * Screenshot thumbnail. Renders consistently on both client navigation and a
 * hard refresh: a subtle shimmer while loading, the image once decoded, or a
 * styled placeholder if the object is missing/broken.
 *
 * On a hard refresh the browser may finish (or fail) loading the <img> BEFORE
 * React hydrates, so onLoad/onError never fire. The mount effect reconciles that
 * by inspecting `complete` / `naturalWidth`.
 */
export function ScreenshotThumb({ src, alt }: { src: string; alt: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = ref.current;
    if (img?.complete) {
      setStatus(img.naturalWidth > 0 ? "loaded" : "error");
    }
  }, [src]);

  if (status === "error") {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-1 bg-panel-2 text-slate-400">
        <ImageOff className="size-6" />
        <span className="text-[10px]">No preview</span>
      </div>
    );
  }

  return (
    <div className="relative size-full bg-panel-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- presigned S3/MinIO URL, not a static asset */}
      <img
        ref={ref}
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
        className={`size-full object-cover transition-opacity duration-300 ${status === "loaded" ? "opacity-100" : "opacity-0"}`}
      />
      {status === "loading" ? <div className="absolute inset-0 animate-pulse bg-panel-2" /> : null}
    </div>
  );
}
