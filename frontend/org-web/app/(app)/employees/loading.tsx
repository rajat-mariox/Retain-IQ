import { SkeletonShell, SkeletonTableCard } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <SkeletonShell>
      <SkeletonTableCard rows={10} cols={5} />
    </SkeletonShell>
  );
}
