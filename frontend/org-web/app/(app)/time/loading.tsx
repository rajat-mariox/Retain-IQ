import { SkeletonShell, SkeletonStatTiles, SkeletonTableCard } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <SkeletonShell>
      <SkeletonStatTiles count={4} />
      <SkeletonTableCard rows={8} cols={5} />
    </SkeletonShell>
  );
}
