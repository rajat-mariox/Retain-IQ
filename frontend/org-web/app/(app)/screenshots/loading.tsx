import { Skeleton, SkeletonShell } from "@/components/ui/Skeleton";

// Mirrors the gallery: a storage-usage banner + a grid of employee folder cards.
export default function Loading() {
  return (
    <SkeletonShell>
      {/* Storage-usage banner */}
      <div className="rounded-2xl border border-hairline bg-panel/80 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
          <Skeleton className="h-2 w-64 rounded-full" />
        </div>
      </div>

      {/* Employee folder cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-hairline bg-panel/80">
            <div className="flex items-center gap-3 p-5">
              <Skeleton className="size-11 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-hairline px-5 py-3">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-12" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonShell>
  );
}
