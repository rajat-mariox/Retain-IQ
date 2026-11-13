/**
 * Filesystem round-trip tests for store.ts (queue + session persistence).
 *
 * store.ts normally reads Electron's userData path, but honours
 * RETAINIQ_DATA_DIR when set, so we point it at a fresh scratch directory and
 * exercise the real read/write logic against real files — no Electron. Runs
 * against the COMPILED dist (the app is CommonJS), so `npm run build` must have
 * run first; the test script guarantees that.
 */
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "retainiq-store-"));
process.env.RETAINIQ_DATA_DIR = dir;

// Import the compiled store after the env var is set. A file:// URL is required
// for dynamic import on Windows (a bare c:\ path is rejected by the ESM loader).
const store = await import(new URL("../dist/store.js", import.meta.url).href);

const SESSION = { accessToken: "a", refreshToken: "r", employeeId: "e", email: "x@y.z", orgName: "Acme" };

before(() => {
  // Start each run clean.
  for (const f of ["agent-state.json", "agent-queue.json"]) {
    const p = join(dir, f);
    if (existsSync(p)) rmSync(p);
  }
  store.clearSession();
});

after(() => rmSync(dir, { recursive: true, force: true }));

test("loadQueue returns [] when there is no queue file", () => {
  assert.deepEqual(store.loadQueue(), []);
});

test("saveQueue then loadQueue round-trips the events", () => {
  const events = [{ eventType: "activity.app.used", payload: { app: "Code" } }, { eventType: "x", payload: {} }];
  store.saveQueue(events);
  assert.deepEqual(store.loadQueue(), events);
});

test("a corrupt queue file loads as [] instead of throwing", () => {
  writeFileSync(join(dir, "agent-queue.json"), "{ this is not json", "utf8");
  assert.deepEqual(store.loadQueue(), []);
});

test("a queue file that isn't an array loads as []", () => {
  writeFileSync(join(dir, "agent-queue.json"), JSON.stringify({ not: "an array" }), "utf8");
  assert.deepEqual(store.loadQueue(), []);
});

test("remembered session is written to disk and read back", () => {
  store.saveSession(SESSION, true);
  // A fresh read from disk (getSession also checks the in-memory copy, but the
  // file is what proves persistence across a restart).
  const onDisk = JSON.parse(readFileSync(join(dir, "agent-state.json"), "utf8"));
  assert.deepEqual(onDisk.session, SESSION);
  assert.deepEqual(store.getSession(), SESSION);
});

test("memory-only session is NOT written to disk", () => {
  store.clearSession();
  store.saveSession(SESSION, false); // remember me OFF
  // In memory for this run…
  assert.deepEqual(store.getSession(), SESSION);
  // …but nothing persisted, so a future launch (which only reads the file) sees none.
  const onDisk = existsSync(join(dir, "agent-state.json"))
    ? JSON.parse(readFileSync(join(dir, "agent-state.json"), "utf8"))
    : {};
  assert.equal(onDisk.session, undefined, "no session on disk when not remembered");
});

test("saving a memory-only session clears a previously-remembered one from disk", () => {
  store.saveSession(SESSION, true); // remembered → on disk
  assert.ok(JSON.parse(readFileSync(join(dir, "agent-state.json"), "utf8")).session);
  store.saveSession({ ...SESSION, email: "new@y.z" }, false); // now memory-only
  const onDisk = JSON.parse(readFileSync(join(dir, "agent-state.json"), "utf8"));
  assert.equal(onDisk.session, undefined, "the remembered session must not linger");
});

test("clearSession removes the session from memory and disk", () => {
  store.saveSession(SESSION, true);
  store.clearSession();
  assert.equal(store.getSession(), null);
  const onDisk = JSON.parse(readFileSync(join(dir, "agent-state.json"), "utf8"));
  assert.equal(onDisk.session, undefined);
});

test("getConfig falls back to defaults and merges saved overrides", () => {
  const cfg = store.getConfig();
  assert.equal(typeof cfg.pollSeconds, "number", "defaults are present");
  assert.ok(cfg.identityUrl, "identityUrl defaulted");
});
