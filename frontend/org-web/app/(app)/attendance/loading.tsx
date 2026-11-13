import { Skeleton, SkeletonShell, SkeletonStatTiles, SkeletonCard, SkeletonTableCard } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <SkeletonShell>
      {/* "Today" check-in/out card */}
      <SkeletonCard>
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-9 w-28 rounded-xl" />
        </div>
      </SkeletonCard>
      <SkeletonStatTiles count={4} />
      <SkeletonTableCard rows={8} cols={4} />
    </SkeletonShell>
  );
}
