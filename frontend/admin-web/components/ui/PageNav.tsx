import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Server-side pagination control (card footer). Renders Prev/Next as <Link>s
 * that set ?page=N, so the page re-fetches that page from the API. Hidden when
 * there's nothing to page.
 */
export function PageNav({
  page,
  pageSize,
  total,
  basePath,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
}) {
  if (total === 0) return null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount); // tolerate out-of-range ?page=
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);
  // basePath may already carry a query (e.g. ?category=login) — pick the right separator.
  const href = (p: number) => `${basePath}${basePath.includes("?") ? "&" : "?"}page=${p}`;

  return (
    <div className="flex items-center justify-between gap-4 border-t border-hairline px-5 py-3 text-xs text-slate-500">
      <span>
        Showing <span className="font-medium text-slate-700">{from}–{to}</span> of <span className="font-medium text-slate-700">{total}</span>
      </span>
      <div className="flex items-center gap-1.5">
        <NavBtn href={href(current - 1)} disabled={current <= 1} label="Previous page">
          <ChevronLeft className="size-4" />
        </NavBtn>
        <span className="px-1 tabular-nums">Page {current} / {pageCount}</span>
        <NavBtn href={href(current + 1)} disabled={current >= pageCount} label="Next page">
          <ChevronRight className="size-4" />
        </NavBtn>
      </div>
    </div>
  );
}

function NavBtn({ href, disabled, label, children }: { href: string; disabled: boolean; label: string; children: ReactNode }) {
  const base = "inline-flex size-7 items-center justify-center rounded-lg border border-hairline";
  if (disabled) {
    return <span className={`${base} bg-panel text-slate-300`} aria-disabled>{children}</span>;
  }
  return (
    <Link href={href} scroll={false} aria-label={label} className={`${base} bg-panel text-slate-600 transition-colors hover:bg-panel-2`}>
      {children}
    </Link>
  );
}
