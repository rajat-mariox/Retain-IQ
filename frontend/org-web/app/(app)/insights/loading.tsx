import { SkeletonShell, SkeletonStatTiles, SkeletonCard, SkeletonTableCard } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <SkeletonShell>
      <SkeletonStatTiles count={4} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SkeletonTableCard rows={8} cols={4} />
        </div>
        <SkeletonCard>
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="h-4 w-1/2 animate-pulse rounded-md bg-slate-200/70" />
                <div className="h-4 w-10 animate-pulse rounded-md bg-slate-200/70" />
              </div>
            ))}
          </div>
        </SkeletonCard>
      </div>
    </SkeletonShell>
  );
}
