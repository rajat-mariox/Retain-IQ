import { SkeletonShell, SkeletonListCard } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <SkeletonShell>
      <SkeletonListCard rows={8} />
    </SkeletonShell>
  );
}
