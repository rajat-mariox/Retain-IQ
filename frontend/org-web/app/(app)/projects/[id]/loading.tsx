import { Skeleton, SkeletonShell } from "@/components/ui/Skeleton";

// Kanban board skeleton: 4 status columns, each with a few task cards.
export default function Loading() {
  return (
    <SkeletonShell>
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, col) => (
          <div key={col} className="rounded-2xl border border-hairline bg-panel/60 p-3">
            <div className="mb-3 flex items-center justify-between px-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-6 rounded-full" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: 3 - (col % 2) }).map((_, t) => (
                <div key={t} className="space-y-2 rounded-xl border border-hairline bg-panel p-3">
                  <Skeleton className="h-4 w-3/4" />
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-14 rounded-full" />
                    <Skeleton className="size-5 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SkeletonShell>
  );
}
