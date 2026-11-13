"use client";

import { useEffect, useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/cn";
import type { OrgSession } from "@/lib/api";

/* -------------------------------------------------------------------------- */
/*  Shared form styling — mirrors the legacy payroll panels exactly.          */
/* -------------------------------------------------------------------------- */

export const inputCls =
  "w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none disabled:bg-slate-50 disabled:text-slate-500";
export const labelCls = "mb-1.5 block text-sm font-medium text-slate-700";

/* -------------------------------------------------------------------------- */
/*  Permission helper                                                          */
/* -------------------------------------------------------------------------- */

/** Does the signed-in role hold a payroll permission? Access is never by role name. */
export const can = (session: OrgSession, permission: string): boolean =>
  session.role.permissions.includes(permission);

/**
 * Pull a human message out of a failed BFF response, tolerating both shapes the
 * payroll proxy can return: the normalised `{ error: "message" }` and the raw
 * backend envelope `{ error: { message } }`. Falls back only when neither says
 * anything useful.
 */
export function readError(body: unknown, fallback: string): string {
  const b = (body ?? {}) as { error?: unknown; message?: string };
  if (typeof b.error === "string") return b.error;
  if (b.error && typeof b.error === "object") {
    const m = (b.error as { message?: string }).message;
    if (m) return m;
  }
  if (typeof b.message === "string") return b.message;
  return fallback;
}

/* -------------------------------------------------------------------------- */
/*  Money & time formatting                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Workspace money values are plain decimal amounts (NOT cents) carrying their own
 * ISO currency code. Fixed en-US locale so a server prerender and the client agree.
 */
export function money(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Minutes rendered as compact hours (e.g. 150 → "2h 30m"). */
export function fmtHoursFromMinutes(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(minutes);
  return `${sign}${Math.floor(abs / 60)}h ${String(abs % 60).padStart(2, "0")}m`;
}

/* -------------------------------------------------------------------------- */
/*  Sensitive (field-level authz) values                                       */
/* -------------------------------------------------------------------------- */

/**
 * A compensation/bank/tax field the backend serialised with its visibility state:
 *  - visible=false → caller lacks the field-level read permission (omit entirely)
 *  - masked=true   → caller may see the field exists but not the raw value
 *  - otherwise `value` is present (caller holds salary.view_sensitive)
 */
export interface Sensitive<T> {
  value: T | null;
  masked: boolean;
  visible: boolean;
}

/** Render a sensitive value honouring the mask/visibility flags the API returned. */
export function MaskedField<T>({
  field,
  format,
  className,
}: {
  field: Sensitive<T> | null | undefined;
  format: (value: T) => string;
  className?: string;
}) {
  if (!field || !field.visible) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-slate-400", className)} title="You don't have permission to view this field">
        <Lock className="size-3" /> hidden
      </span>
    );
  }
  if (field.masked) {
    return (
      <span className={cn("inline-flex items-center gap-1 tabular-nums text-slate-400", className)} title="Masked — needs the salary.view_sensitive permission">
        <Lock className="size-3" /> ••••••
      </span>
    );
  }
  if (field.value === null || field.value === undefined) return <span className={cn("text-slate-400", className)}>—</span>;
  return <span className={className}>{format(field.value)}</span>;
}

/* -------------------------------------------------------------------------- */
/*  Variable-pay status badge                                                  */
/* -------------------------------------------------------------------------- */

export type VariablePayStatus =
  | "DRAFT"
  | "MANAGER_APPROVAL"
  | "REVIEW"
  | "APPROVED"
  | "INCLUDED_IN_PAYROLL"
  | "REJECTED"
  | "CANCELLED";

const VP_BADGE: Record<string, string> = {
  DRAFT: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
  MANAGER_APPROVAL: "bg-sky-500/10 text-sky-700 ring-sky-600/20",
  REVIEW: "bg-sky-500/10 text-sky-700 ring-sky-600/20",
  APPROVED: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
  INCLUDED_IN_PAYROLL: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20",
  REJECTED: "bg-rose-500/10 text-rose-700 ring-rose-600/20",
  CANCELLED: "bg-slate-500/10 text-slate-500 ring-slate-500/20",
};

export function VariablePayBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", VP_BADGE[status] ?? "bg-panel-2 text-slate-600 ring-hairline")}>
      {status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Employee directory (names for pickers + row display)                       */
/* -------------------------------------------------------------------------- */

export interface PayrollEmployeeOption {
  id: string;
  name: string;
  title: string | null;
  department: string | null;
  status: string;
}

/**
 * The employees within the caller's reach, for pickers and id→name display.
 * Fetched once client-side; degrades to an empty directory (and short-id
 * fallbacks) if the caller lacks employee.read, so panels never hard-fail on it.
 */
export function useEmployeeDirectory(): { list: PayrollEmployeeOption[]; byId: Map<string, PayrollEmployeeOption>; loading: boolean } {
  const [list, setList] = useState<PayrollEmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    // The backend owns "who is payroll staff" — this directory is already
    // ABAC-scoped and has the Owner (not staff) filtered out, with names
    // composed server-side. Panels degrade to an empty directory on error.
    fetch("/api/payroll/directory", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((rows: PayrollEmployeeOption[] | null) => {
        if (alive && Array.isArray(rows)) setList(rows);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const byId = useMemo(() => new Map(list.map((e) => [e.id, e])), [list]);
  return { list, byId, loading };
}

/** Display an employee's name from a directory map, falling back to a short id. */
export function employeeName(byId: Map<string, PayrollEmployeeOption>, id: string): string {
  return byId.get(id)?.name ?? `#${id.slice(0, 8)}`;
}

/** A <select> of reachable employees (active first). */
export function EmployeePicker({
  value,
  onChange,
  employees,
  placeholder = "Select an employee…",
  disabled,
  id,
}: {
  value: string;
  onChange: (employeeId: string) => void;
  employees: PayrollEmployeeOption[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}) {
  const sorted = useMemo(() => {
    return [...employees].sort((a, b) => {
      const aActive = a.status === "ACTIVE" ? 0 : 1;
      const bActive = b.status === "ACTIVE" ? 0 : 1;
      return aActive - bActive || a.name.localeCompare(b.name);
    });
  }, [employees]);

  return (
    <select id={id} className={inputCls} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {sorted.map((e) => (
        <option key={e.id} value={e.id}>
          {e.name}
          {e.status !== "ACTIVE" ? ` (${e.status.toLowerCase()})` : ""}
          {e.title ? ` — ${e.title}` : ""}
        </option>
      ))}
    </select>
  );
}

/* -------------------------------------------------------------------------- */
/*  Small primitives shared across panels                                      */
/* -------------------------------------------------------------------------- */

/** Consistent primary button used for panel-level "create" actions. */
export const primaryBtn =
  "inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-soft disabled:opacity-60";
export const secondaryBtn =
  "inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-panel px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";

/** Standard "you can't reach this tab" empty card body text. */
export function NoAccess({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-12 text-center text-sm text-slate-500">{children}</p>;
}
