import { createHmac, randomBytes } from "node:crypto";

/**
 * Generates a high-entropy opaque refresh token. The raw value is returned to
 * the client exactly once; only its keyed hash is ever persisted.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Derives the stored hash of a refresh token using HMAC-SHA256 peppered with
 * the refresh secret. Keyed hashing means a leaked database cannot be used to
 * forge tokens without also leaking the secret.
 */
export function hashRefreshToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}
