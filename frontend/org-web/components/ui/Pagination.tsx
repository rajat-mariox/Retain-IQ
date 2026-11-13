"use client";

import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

function paginate(total: number, pageSize: number, page: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * pageSize;
  return { pageCount, current, start, end: Math.min(start + pageSize, total) };
}

/** "Showing X–Y of Z" + Prev/Next. Rendered as a card footer; hidden when empty. */
export function PaginationBar({
  page,
  pageCount,
  from,
  to,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  onPage: (p: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between gap-4 border-t border-hairline px-5 py-3 text-xs text-slate-500">
      <span>
        Showing <span className="font-medium text-slate-700">{from}–{to}</span> of <span className="font-medium text-slate-700">{total}</span>
      </span>
      <div className="flex items-center gap-1.5">
        <PageButton disabled={page <= 1} onClick={() => onPage(page - 1)} label="Previous page">
          <ChevronLeft className="size-4" />
        </PageButton>
        <span className="px-1 tabular-nums">Page {page} / {pageCount}</span>
        <PageButton disabled={page >= pageCount} onClick={() => onPage(page + 1)} label="Next page">
          <ChevronRight className="size-4" />
        </PageButton>
      </div>
    </div>
  );
}

function PageButton({ children, disabled, onClick, label }: { children: ReactNode; disabled?: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className="inline-flex size-7 items-center justify-center rounded-lg border border-hairline bg-panel text-slate-600 transition-colors hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/**
 * Paginated <table>. The server component maps its rows to <tr> nodes and passes
 * them as `rows`; this client component slices them per page. `head` is the
 * <tr> of <th>s; `empty` is the colspanned empty <tr>.
 */
export function PaginatedTable({
  head,
  rows,
  empty,
  pageSize = 10,
  minWidth = "min-w-[640px]",
}: {
  head: ReactNode;
  rows: ReactNode[];
  empty?: ReactNode;
  pageSize?: number;
  minWidth?: string;
}) {
  const [page, setPage] = useState(1);
  const total = rows.length;
  const { pageCount, current, start, end } = paginate(total, pageSize, page);
  return (
    <>
      <div className="overflow-x-auto">
        <table className={cn("w-full text-sm", minWidth)}>
          <thead>{head}</thead>
          <tbody>{total === 0 ? empty : rows.slice(start, end)}</tbody>
        </table>
      </div>
      <PaginationBar page={current} pageCount={pageCount} from={start + 1} to={end} total={total} onPage={setPage} />
    </>
  );
}

/** Paginated <ul>: pass already-mapped <li> nodes as `items`. */
export function PaginatedList({
  items,
  empty,
  pageSize = 8,
  className = "divide-y divide-hairline/60",
}: {
  items: ReactNode[];
  empty?: ReactNode;
  pageSize?: number;
  className?: string;
}) {
  const [page, setPage] = useState(1);
  const total = items.length;
  const { pageCount, current, start, end } = paginate(total, pageSize, page);
  return (
    <>
      {total === 0 ? <ul className={className}>{empty}</ul> : <ul className={className}>{items.slice(start, end)}</ul>}
      <PaginationBar page={current} pageCount={pageCount} from={start + 1} to={end} total={total} onPage={setPage} />
    </>
  );
}

/** Paginated grid of cards: pass already-mapped card nodes as `items`. */
export function PaginatedGrid({
  items,
  empty,
  pageSize = 9,
  className,
}: {
  items: ReactNode[];
  empty?: ReactNode;
  pageSize?: number;
  className?: string;
}) {
  const [page, setPage] = useState(1);
  const total = items.length;
  const { pageCount, current, start, end } = paginate(total, pageSize, page);
  if (total === 0) return <div className={className}>{empty}</div>;
  return (
    <div className="space-y-4">
      <div className={className}>{items.slice(start, end)}</div>
      <PaginationBar page={current} pageCount={pageCount} from={start + 1} to={end} total={total} onPage={setPage} />
    </div>
  );
}
