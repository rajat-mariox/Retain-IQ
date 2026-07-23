/**
 * Tiny JSON-file persistence for the agent's session (tokens + employeeId) and
 * config, stored under Electron's per-user userData directory. No external deps.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG, type AgentConfig } from "./config.js";

/**
 * Electron's userData path, loaded lazily. Kept out of the module's top level so
 * that when RETAINIQ_DATA_DIR is set (tests, tooling) the store works without
 * pulling in Electron at all.
 */
function userDataDir(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require("electron") as typeof import("electron");
  return app.getPath("userData");
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  employeeId: string;
  email: string;
  orgName: string;
}

interface Persisted {
  session?: Session;
  config?: Partial<AgentConfig>;
}

function dataDir(): string {
  // RETAINIQ_DATA_DIR lets tests point persistence at a scratch directory
  // without loading Electron; in the app it's unset and we use userData.
  const dir = process.env.RETAINIQ_DATA_DIR ?? userDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function file(): string {
  return join(dataDir(), "agent-state.json");
}

function queueFile(): string {
  return join(dataDir(), "agent-queue.json");
}

/** Load the persisted, not-yet-uploaded event queue (empty if none/corrupt). */
export function loadQueue<T>(): T[] {
  try {
    const parsed = JSON.parse(readFileSync(queueFile(), "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** Persist the current event queue so it survives a crash / force-quit. */
export function saveQueue(events: unknown[]): void {
  try {
    writeFileSync(queueFile(), JSON.stringify(events), "utf8");
  } catch {
    // Best-effort: a failed persist must never crash the collector.
  }
}

function read(): Persisted {
  try {
    return JSON.parse(readFileSync(file(), "utf8")) as Persisted;
  } catch {
    return {};
  }
}

function write(data: Persisted): void {
  writeFileSync(file(), JSON.stringify(data, null, 2), "utf8");
}

export function getConfig(): AgentConfig {
  return { ...DEFAULT_CONFIG, ...(read().config ?? {}) };
}

// A memory-only session (used when "Remember me" is off) — never written to disk,
// so it's gone on next launch.
let memorySession: Session | null = null;

export function getSession(): Session | null {
  return memorySession ?? read().session ?? null;
}

/** Persist the session to disk (remembered) or keep it in memory only for this run. */
export function saveSession(session: Session, persist = true): void {
  memorySession = session;
  if (persist) {
    write({ ...read(), session });
  } else {
    // Memory-only: make sure no previously-remembered session lingers on disk.
    const data = read();
    delete data.session;
    write(data);
  }
}

export function clearSession(): void {
  memorySession = null;
  const data = read();
  delete data.session;
  write(data);
}
