import { SkeletonShell, SkeletonTableCard, Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <SkeletonShell>
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-28 rounded-full" />
        ))}
      </div>
      <SkeletonTableCard rows={10} cols={6} />
    </SkeletonShell>
  );
}
