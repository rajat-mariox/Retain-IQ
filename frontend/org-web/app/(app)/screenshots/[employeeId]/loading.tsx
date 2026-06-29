import { Skeleton, SkeletonShell } from "@/components/ui/Skeleton";

// Mirrors the per-employee view: a back link + a grid of thumbnail tiles.
export default function Loading() {
  return (
    <SkeletonShell>
      <Skeleton className="h-4 w-32" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {Array.from({ length: 18 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-hairline bg-panel">
            <Skeleton className="aspect-video w-full rounded-none" />
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-2.5 w-8" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonShell>
  );
}
