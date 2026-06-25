import { Info } from "lucide-react";

export function MockNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-sm text-amber-800">
      <Info className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <p className="leading-relaxed">{children}</p>
    </div>
  );
}
