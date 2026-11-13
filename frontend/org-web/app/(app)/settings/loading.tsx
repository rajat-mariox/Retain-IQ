import { Skeleton, SkeletonShell, SkeletonCard, SkeletonTableCard } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <SkeletonShell>
      {/* Organization profile */}
      <SkeletonCard>
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        </div>
      </SkeletonCard>
      {/* Members */}
      <SkeletonTableCard rows={6} cols={4} />
    </SkeletonShell>
  );
}
