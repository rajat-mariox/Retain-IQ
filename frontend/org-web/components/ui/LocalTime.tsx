"use client";

import { useEffect, useState } from "react";

type Mode = "time" | "datetime" | "date";

// All timestamps are stored and sent as UTC ISO strings; we render them in the
// viewer's own timezone. Because the page is server-rendered (the container runs
// in UTC), we render UTC on the server and on the first client paint — so the
// hydrated HTML matches exactly — then re-render in the local timezone after
// mount. `suppressHydrationWarning` guards the intentional swap.
function fmt(iso: string, mode: Mode, tz?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const zone = tz ? { timeZone: tz } : {};
  if (mode === "datetime") return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", ...zone });
  if (mode === "date") return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", ...zone });
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", ...zone });
}

export function LocalTime({
  iso,
  mode = "time",
  fallback = "—",
}: {
  iso: string | null | undefined;
  mode?: Mode;
  fallback?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!iso) return <>{fallback}</>;
  const text = mounted ? fmt(iso, mode) : fmt(iso, mode, "UTC");
  // Full local datetime as a hover title, useful when only the time is shown.
  const title = mounted ? fmt(iso, "datetime") : undefined;
  return (
    <time dateTime={iso} title={title} suppressHydrationWarning>
      {text}
    </time>
  );
}
