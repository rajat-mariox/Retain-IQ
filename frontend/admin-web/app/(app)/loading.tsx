import { SkeletonShell, SkeletonStatTiles, SkeletonChartCard, SkeletonCard } from "@/components/ui/Skeleton";

// Overview skeleton (also the group-level fallback for any (app) route without
// its own loading.tsx). Shown instantly on navigation; the Sidebar stays put.
export default function Loading() {
  return (
    <SkeletonShell>
      <SkeletonStatTiles count={4} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SkeletonChartCard height="h-72" />
        </div>
        <SkeletonCard>
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="h-4 w-1/2 animate-pulse rounded-md bg-slate-200/70" />
                <div className="h-4 w-12 animate-pulse rounded-md bg-slate-200/70" />
              </div>
            ))}
          </div>
        </SkeletonCard>
      </div>
    </SkeletonShell>
  );
}
