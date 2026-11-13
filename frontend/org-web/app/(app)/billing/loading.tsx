import { Skeleton, SkeletonShell, SkeletonCard, SkeletonTableCard } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <SkeletonShell>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Current plan (spans 2) */}
        <SkeletonCard className="xl:col-span-2">
          <div className="space-y-5">
            <Skeleton className="h-8 w-40" />
            <div className="grid grid-cols-2 gap-4 border-t border-hairline/60 pt-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-28" />
                </div>
              ))}
            </div>
          </div>
        </SkeletonCard>
        {/* Plans list */}
        <SkeletonCard>
          <div className="space-y-2.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        </SkeletonCard>
      </div>
      <SkeletonTableCard rows={6} cols={6} />
    </SkeletonShell>
  );
}
