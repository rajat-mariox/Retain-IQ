/**
 * Tiny JSON-file persistence for the agent's session (tokens + employeeId) and
 * config, stored under Electron's per-user userData directory. No external deps.
 */
import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG, type AgentConfig } from "./config.js";

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
  const dir = app.getPath("userData");
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

export function getSession(): Session | null {
  return read().session ?? null;
}

export function saveSession(session: Session): void {
  write({ ...read(), session });
}

export function clearSession(): void {
  const data = read();
  delete data.session;
  write(data);
}
