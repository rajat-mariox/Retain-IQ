import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("space-y-6 px-5 py-6 lg:px-8", className)}>{children}</div>;
}
