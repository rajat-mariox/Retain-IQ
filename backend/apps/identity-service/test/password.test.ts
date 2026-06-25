import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "../src/common/crypto/password.util.ts";

test("hashPassword + verifyPassword round-trips a correct password", async () => {
  const hash = await hashPassword("CorrectHorseBattery1!");
  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyPassword("CorrectHorseBattery1!", hash), true);
});

test("verifyPassword rejects an incorrect password", async () => {
  const hash = await hashPassword("CorrectHorseBattery1!");
  assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("verifyPassword returns false for a malformed hash instead of throwing", async () => {
  assert.equal(await verifyPassword("anything", "not-a-valid-hash"), false);
  assert.equal(await verifyPassword("anything", ""), false);
});

test("hashPassword produces a unique salt per call", async () => {
  const a = await hashPassword("samePassword123!");
  const b = await hashPassword("samePassword123!");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("samePassword123!", a), true);
  assert.equal(await verifyPassword("samePassword123!", b), true);
});
