import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateRefreshToken,
  hashRefreshToken,
} from "../src/common/crypto/refresh-token.util.ts";

test("generateRefreshToken returns high-entropy, unique tokens", () => {
  const a = generateRefreshToken();
  const b = generateRefreshToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40);
});

test("hashRefreshToken is deterministic for the same token + secret", () => {
  const token = generateRefreshToken();
  assert.equal(hashRefreshToken(token, "secret-a"), hashRefreshToken(token, "secret-a"));
});

test("hashRefreshToken depends on the secret (pepper)", () => {
  const token = generateRefreshToken();
  assert.notEqual(hashRefreshToken(token, "secret-a"), hashRefreshToken(token, "secret-b"));
});

test("hashRefreshToken never returns the raw token", () => {
  const token = generateRefreshToken();
  const hash = hashRefreshToken(token, "secret");
  assert.notEqual(hash, token);
  assert.match(hash, /^[0-9a-f]{64}$/);
});
