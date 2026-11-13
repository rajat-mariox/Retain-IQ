import { Skeleton, SkeletonShell, SkeletonStatTiles, SkeletonCard, SkeletonTableCard } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <SkeletonShell>
      <SkeletonStatTiles count={4} />
      {/* Attendance today strip */}
      <SkeletonCard>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-12" />
            </div>
          ))}
        </div>
      </SkeletonCard>
      {/* Employees */}
      <SkeletonTableCard rows={8} cols={5} />
    </SkeletonShell>
  );
}
