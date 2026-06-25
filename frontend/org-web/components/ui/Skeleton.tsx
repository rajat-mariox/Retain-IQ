import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A single shimmering placeholder block. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-slate-200/70", className)} />;
}

/** Topbar header placeholder (title + subtitle + user chip). */
export function SkeletonTopbar() {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-hairline bg-canvas/70 px-5 py-4 backdrop-blur lg:px-8">
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
      <Skeleton className="h-9 w-36 rounded-xl" />
    </header>
  );
}

/** Topbar + the standard padded content container. */
export function SkeletonShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SkeletonTopbar />
      <div className="space-y-6 px-5 py-6 lg:px-8">{children}</div>
    </>
  );
}

const tileGrid: Record<number, string> = {
  3: "grid grid-cols-1 gap-4 sm:grid-cols-3",
  4: "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4",
};

/** Row of KPI stat tiles. */
export function SkeletonStatTiles({ count = 4 }: { count?: number }) {
  return (
    <div className={tileGrid[count] ?? tileGrid[4]}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-hairline bg-panel/80 p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-20" />
        </div>
      ))}
    </div>
  );
}

/** A card shell with a header (title + optional subtitle). */
export function SkeletonCard({ children, className, header = true }: { children?: ReactNode; className?: string; header?: boolean }) {
  return (
    <div className={cn("rounded-2xl border border-hairline bg-panel/80", className)}>
      {header ? (
        <div className="space-y-2 border-b border-hairline px-5 py-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-44" />
        </div>
      ) : null}
      <div className="px-5 py-5">{children}</div>
    </div>
  );
}

/** Card wrapping a table (header row + body rows). */
export function SkeletonTableCard({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <SkeletonCard>
      <div className="space-y-3">
        {/* header row */}
        <div className="flex gap-4 border-b border-hairline pb-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-3 flex-1" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 py-1">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className={cn("h-4 flex-1", c === 0 && "max-w-[40%]")} />
            ))}
          </div>
        ))}
      </div>
    </SkeletonCard>
  );
}

/** Card with a chart-area block + a small legend strip. */
export function SkeletonChartCard({ height = "h-64" }: { height?: string }) {
  return (
    <SkeletonCard>
      <Skeleton className={cn("w-full rounded-xl", height)} />
      <div className="mt-4 flex gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-20" />
        ))}
      </div>
    </SkeletonCard>
  );
}

/** Inbox-style stacked list rows. */
export function SkeletonListCard({ rows = 6 }: { rows?: number }) {
  return (
    <SkeletonCard>
      <div className="space-y-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton className="size-9 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-3/4" />
            </div>
            <Skeleton className="h-3 w-14" />
          </div>
        ))}
      </div>
    </SkeletonCard>
  );
}

/** Grid of small cards (e.g. project tiles). */
export function SkeletonCardGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-2xl border border-hairline bg-panel/80 p-5">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-2 w-full rounded-full" />
          <div className="flex justify-between pt-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-10" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Generic fallback (used by the (app) group-level loading.tsx for any route
 * without a tailored skeleton): Topbar + stat tiles + two content cards.
 */
export function PageSkeleton() {
  return (
    <SkeletonShell>
      <SkeletonStatTiles count={4} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SkeletonTableCard rows={5} cols={3} />
        <SkeletonCard>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </SkeletonCard>
      </div>
    </SkeletonShell>
  );
}
