import { SkeletonShell, SkeletonStatTiles, Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <SkeletonShell>
      <Skeleton className="h-5 w-40" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-hairline bg-panel/80 p-5">
            <Skeleton className="mb-4 h-4 w-32" />
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, j) => (
                <Skeleton key={j} className="h-6 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-5 w-40" />
      <SkeletonStatTiles count={4} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    </SkeletonShell>
  );
}
