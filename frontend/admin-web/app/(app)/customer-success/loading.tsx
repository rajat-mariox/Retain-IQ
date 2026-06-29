import { SkeletonShell, SkeletonStatTiles, SkeletonTableCard, Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <SkeletonShell>
      <SkeletonStatTiles count={4} />
      <Skeleton className="h-5 w-32" />
      <SkeletonStatTiles count={3} />
      <SkeletonTableCard rows={8} cols={7} />
    </SkeletonShell>
  );
}
