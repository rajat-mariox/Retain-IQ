import { Skeleton, SkeletonShell, SkeletonCardGrid } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <SkeletonShell>
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-32 rounded-xl" />
      </div>
      <SkeletonCardGrid count={6} />
    </SkeletonShell>
  );
}
