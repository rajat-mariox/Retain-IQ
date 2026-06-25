import { SkeletonShell, SkeletonStatTiles, SkeletonChartCard } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <SkeletonShell>
      <SkeletonStatTiles count={3} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonChartCard key={i} height="h-56" />
        ))}
      </div>
    </SkeletonShell>
  );
}
