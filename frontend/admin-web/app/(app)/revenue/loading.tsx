import { SkeletonShell, SkeletonStatTiles, SkeletonChartCard } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <SkeletonShell>
      <SkeletonStatTiles count={4} />
      <SkeletonChartCard height="h-80" />
    </SkeletonShell>
  );
}
