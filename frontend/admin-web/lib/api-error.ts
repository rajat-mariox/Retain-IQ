/**
 * Shape the identity-service error envelope into something a form can act on.
 *
 * The API answers with { error: { message, details?: [{ path, message }] } }.
 * BFF routes used to read `data.message` — a level too shallow — so every failure
 * collapsed to a generic fallback and the per-field reasons were thrown away.
 */

export interface FieldIssue {
  /** Field name, matching the form's own key. */
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: string;
  fields?: Record<string, string>;
}

interface ApiEnvelope {
  error?: { message?: string; details?: { path?: string; message?: string }[] };
  message?: string;
}

/** Zod's phrasing is written for developers; say it the way the person filling the form would. */
function humanize(path: string, message: string): string {
  const field = path.split(".").pop() ?? path;
  const label = field
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();

  if (/at least 1 character|Required|expected string, received undefined/i.test(message)) return `${label} is required.`;
  const min = message.match(/at least (\d+) character/i);
  if (min) return `${label} must be at least ${min[1]} characters.`;
  const max = message.match(/at most (\d+) character/i);
  if (max) return `${label} must be ${max[1]} characters or fewer.`;
  if (/invalid email/i.test(message)) return "Enter a valid email address.";
  if (/invalid uuid/i.test(message)) return `Select a valid ${label.toLowerCase()}.`;
  if (/expected number|nan/i.test(message)) return `${label} must be a number.`;
  if (/greater than or equal to (\d+)/i.test(message)) {
    const n = message.match(/greater than or equal to (\d+)/i)?.[1];
    return `${label} must be ${n} or more.`;
  }
  if (/less than or equal to (\d+)/i.test(message)) {
    const n = message.match(/less than or equal to (\d+)/i)?.[1];
    return `${label} must be ${n} or less.`;
  }
  return message;
}

/**
 * Turn a failed response into a message plus per-field issues. `fallback` is only
 * used when the API said nothing useful — never in place of a real reason.
 */
export async function toFormError(res: Response, fallback: string): Promise<ApiErrorBody> {
  const body = (await res.json().catch(() => ({}))) as ApiEnvelope;
  const envelope = body.error;
  const details = envelope?.details ?? [];

  if (details.length > 0) {
    const fields: Record<string, string> = {};
    for (const d of details) {
      if (d.path && d.message) fields[d.path] = humanize(d.path, d.message);
    }
    const count = Object.keys(fields).length;
    return {
      error: count === 1 ? Object.values(fields)[0] : `Fix ${count} fields below to continue.`,
      fields,
    };
  }

  // A business-rule rejection (e.g. "Basic allows at most 50 seats.") — no field
  // path, but the message is written for a human and is the whole point.
  return { error: envelope?.message ?? body.message ?? fallback };
}
