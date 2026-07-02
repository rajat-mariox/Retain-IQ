/**
 * Agent configuration. Base URLs point at the RetainIQ backend; override via
 * environment variables (RETAINIQ_IDENTITY_URL / RETAINIQ_INGESTION_URL) or the
 * saved config file. Defaults target a local dev stack.
 */
export interface AgentConfig {
  identityUrl: string;
  ingestionUrl: string;
  pollSeconds: number; // how often the active window / idle is sampled
  flushSeconds: number; // how often queued events are uploaded
  idleThresholdSeconds: number; // no input for this long → idle
  maxBatch: number; // max events per upload
  maxQueue: number; // cap on locally-buffered events (oldest dropped beyond this)
  tabServerPort: number; // loopback port the browser extension reports active tabs to
  tabFreshnessMs: number; // how long a reported tab is considered "current"
}

export const DEFAULT_CONFIG: AgentConfig = {
  identityUrl: process.env.RETAINIQ_IDENTITY_URL ?? "http://localhost:3001",
  ingestionUrl: process.env.RETAINIQ_INGESTION_URL ?? "http://localhost:3002",
  pollSeconds: Number(process.env.RETAINIQ_POLL_SECONDS ?? 15),
  flushSeconds: Number(process.env.RETAINIQ_FLUSH_SECONDS ?? 30),
  idleThresholdSeconds: Number(process.env.RETAINIQ_IDLE_SECONDS ?? 300),
  maxBatch: 200,
  maxQueue: Number(process.env.RETAINIQ_MAX_QUEUE ?? 10_000),
  tabServerPort: Number(process.env.RETAINIQ_TAB_PORT ?? 7317),
  tabFreshnessMs: 120_000,
};
