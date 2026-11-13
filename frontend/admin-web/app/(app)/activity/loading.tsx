import { Skeleton, SkeletonShell } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <SkeletonShell>
      <div className="rounded-2xl border border-hairline bg-panel/80">
        <div className="divide-y divide-hairline/60">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 px-5 py-3.5">
              <Skeleton className="size-8 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </SkeletonShell>
  );
}
