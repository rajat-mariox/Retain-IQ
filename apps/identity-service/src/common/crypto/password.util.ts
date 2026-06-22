import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type BinaryLike,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";

// promisify drops the options overload, so re-type it explicitly.
const scrypt = promisify(scryptCallback) as (
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

// scrypt parameters. Encoded into the hash so they can be tuned without
// invalidating existing credentials.
const KEYLEN = 64;
const COST = 16384; // N
const BLOCK_SIZE = 8; // r
const PARALLELIZATION = 1; // p

/**
 * Hashes a plaintext password using scrypt (Node built-in, no native deps).
 * Format: scrypt$N$r$p$saltHex$hashHex
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(plain, salt, KEYLEN, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
  });

  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

/**
 * Verifies a plaintext password against a stored scrypt hash in constant time.
 * Returns false for malformed hashes rather than throwing.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const [, costRaw, blockRaw, parRaw, saltHex, hashHex] = parts;
  if (!saltHex || !hashHex) {
    return false;
  }
  const cost = Number(costRaw);
  const blockSize = Number(blockRaw);
  const parallelization = Number(parRaw);
  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelization)) {
    return false;
  }

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = await scrypt(plain, salt, expected.length, {
    N: cost,
    r: blockSize,
    p: parallelization,
  });

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
