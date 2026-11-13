"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search, Users } from "lucide-react";
import type { EmployeeRow } from "@/lib/api";

interface Emp {
  id: string;
  name: string;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Searchable employee picker. Filtering is done **server-side** (`/api/employees?q=`)
 * so it scales past the first page; `initial` seeds the list before any search.
 * `""` selects all employees. onChange returns both id and name (the parent may
 * not have the name otherwise, since a match can come from beyond the first page).
 */
export function EmployeeSelect({ initial, value, selectedName, onChange }: { initial: Emp[]; value: string; selectedName: string; onChange: (id: string, name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Emp[]>(initial);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Debounced server-side search; empty query falls back to the seeded list.
  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setResults(initial);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/employees?q=${encodeURIComponent(query)}&pageSize=25`)
        .then((r) => r.json())
        .then((d: { items?: EmployeeRow[] }) => setResults((d.items ?? []).map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`.trim() }))))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, initial]);

  const pick = (id: string, name: string) => {
    onChange(id, name);
    setOpen(false);
    setQ("");
  };

  const Avatar = ({ children, all }: { children?: React.ReactNode; all?: boolean }) => (
    <span className={`grid size-6 shrink-0 place-items-center rounded-md text-[10px] font-semibold ${all ? "bg-panel-2 text-slate-500 ring-1 ring-inset ring-hairline" : "bg-brand/10 text-brand"}`}>{children}</span>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-56 items-center gap-2 rounded-lg border border-hairline bg-panel px-2.5 py-1.5 text-sm text-slate-800 transition-colors hover:bg-slate-50 focus:border-brand focus:outline-none"
      >
        {value ? <Avatar>{initials(selectedName || "?")}</Avatar> : <Avatar all><Users className="size-3.5" /></Avatar>}
        <span className="flex-1 truncate text-left font-medium">{value ? selectedName || "Employee" : "All employees"}</span>
        <ChevronDown className={`size-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-1.5 w-64 overflow-hidden rounded-xl border border-hairline bg-panel shadow-lg ring-1 ring-black/5" role="listbox">
          <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
            <Search className="size-4 shrink-0 text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee…" className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none" />
          </div>
          <ul className={`max-h-72 overflow-auto py-1 ${loading ? "opacity-60" : ""}`}>
            <li>
              <button type="button" onClick={() => pick("", "")} className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50">
                <Avatar all><Users className="size-3.5" /></Avatar>
                <span className="flex-1 text-left font-medium text-slate-700">All employees</span>
                {value === "" ? <Check className="size-4 text-brand" /> : null}
              </button>
            </li>
            {results.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => pick(e.id, e.name)} className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50">
                  <Avatar>{initials(e.name)}</Avatar>
                  <span className="flex-1 truncate text-left text-slate-800">{e.name}</span>
                  {value === e.id ? <Check className="size-4 text-brand" /> : null}
                </button>
              </li>
            ))}
            {results.length === 0 && !loading ? <li className="px-3 py-6 text-center text-xs text-slate-400">{q ? `No employee matches “${q}”.` : "No employees."}</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
