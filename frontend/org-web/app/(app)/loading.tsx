import { Skeleton, SkeletonShell, SkeletonStatTiles, SkeletonCard, SkeletonTableCard } from "@/components/ui/Skeleton";

// Dashboard skeleton (also the group-level fallback for any (app) route without
// its own loading.tsx). Shown instantly on navigation; the Sidebar stays put.
export default function Loading() {
  return (
    <SkeletonShell>
      <SkeletonStatTiles count={4} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <SkeletonCard className="xl:col-span-2">
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </SkeletonCard>
        <SkeletonTableCard rows={4} cols={2} />
      </div>
    </SkeletonShell>
  );
}
