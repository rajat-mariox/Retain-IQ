import { randomBytes } from "node:crypto";

/**
 * Generates a human-shareable temporary password (~16 chars, satisfies the
 * 12-char minimum). Issued on invite/create; the user must change it on first
 * login (User.mustChangePassword).
 */
export function generateTempPassword(): string {
  return `Tmp-${randomBytes(9).toString("base64url")}`;
}
