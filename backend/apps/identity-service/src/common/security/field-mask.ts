/**
 * Field-level data masking. Sensitive scalar fields carry a sensitivity level; an
 * authorization decision then renders each as one of three outcomes:
 *
 *   VISIBLE — the real value is returned
 *   MASKED  — a redacted placeholder is returned (e.g. "•••• 7821"), so the field's
 *             existence/shape is visible but not its content
 *   DENIED  — the field is omitted entirely
 *
 * Callers decide VISIBLE vs MASKED from a permission check; DENIED is for fields a
 * viewer shouldn't even know exist. This keeps masking a small, testable unit rather
 * than ad-hoc string slicing scattered across services.
 */
export type SensitivityLevel = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED" | "HIGHLY_RESTRICTED";
export type MaskOutcome = "VISIBLE" | "MASKED" | "DENIED";

export interface MaskedField<T> {
  masked: boolean;
  sensitivity: SensitivityLevel;
  /** The real value when VISIBLE, a redacted string when MASKED, null when absent. */
  value: T | string | null;
}

/** Redact a number to a fixed placeholder — never leaks magnitude. */
export function maskAmount(): string {
  return "••••";
}

/** Show only the last `keep` characters of a string (e.g. "•••• 7821"). */
export function maskTail(value: string, keep = 4): string {
  const tail = value.slice(-keep);
  return `•••• ${tail}`;
}

/**
 * Render a field given its sensitivity and whether the caller is authorized to see
 * the real value. `authorized` VISIBLE; otherwise MASKED (unless the field is
 * absent, in which case it stays null and unmasked).
 */
export function renderField<T>(value: T | null, sensitivity: SensitivityLevel, authorized: boolean, redact: (v: T) => string): MaskedField<T> {
  if (value === null || value === undefined) return { masked: false, sensitivity, value: null };
  if (authorized) return { masked: false, sensitivity, value };
  return { masked: true, sensitivity, value: redact(value) };
}
