// Dependency-free parallel process runner for the frontends + desktop agent.
// npm runs workspace scripts sequentially, which deadlocks on long-running dev
// servers (the first never exits). This spawns them concurrently with prefixed,
// colour-tagged output and forwards Ctrl+C to every child so one keystroke stops
// the whole group. Zero external dependencies — pure node:child_process.
//
//   node scripts/dev-parallel.mjs web    → org-web + admin-web
//   node scripts/dev-parallel.mjs all    → org-web + admin-web + desktop-agent
//   node scripts/dev-parallel.mjs desktop-> desktop-agent only
import { spawn } from "node:child_process";

// Run via a shell so `npm` resolves cross-platform. On Windows, Node 18.20+/
// 20.12+/24 refuse to spawn `npm.cmd` with { shell: false } (throws EINVAL after
// the CVE-2024-27980 fix), so shell:true is REQUIRED here — with it the shell
// finds npm/npm.cmd itself. Args contain no spaces, so no extra quoting needed.
// Each target: a label + the npm invocation. Frontends are workspaces (-w);
// desktop-agent is a standalone project (run via --prefix).
const TARGETS = {
  org: { label: "org-web  ", color: 36, cmd: "npm run dev -w @retainiq/org-web" },
  admin: { label: "admin-web", color: 35, cmd: "npm run dev -w @retainiq/admin-web" },
  desktop: { label: "desktop ", color: 33, cmd: "npm run dev --prefix desktop-agent" },
};

const GROUPS = {
  web: ["org", "admin"],
  all: ["org", "admin", "desktop"],
  desktop: ["desktop"],
};

const mode = process.argv[2] ?? "web";
const keys = GROUPS[mode];
if (!keys) {
  console.error(`Unknown group "${mode}". Use one of: ${Object.keys(GROUPS).join(", ")}`);
  process.exit(1);
}

const children = [];
let shuttingDown = false;

function tag(t, stream, chunk) {
  const prefix = `\x1b[${t.color}m[${t.label}]\x1b[0m `;
  const text = chunk.toString().replace(/\n$/, "").split("\n").map((l) => prefix + l).join("\n");
  stream.write(text + "\n");
}

for (const key of keys) {
  const t = TARGETS[key];
  console.log(`\x1b[${t.color}m[${t.label}]\x1b[0m starting: ${t.cmd}`);
  // shell:true so `npm`/`npm.cmd` resolves on every platform (see note above).
  const child = spawn(t.cmd, { cwd: process.cwd(), shell: true });
  child.on("error", (err) => {
    console.error(`\x1b[${t.color}m[${t.label}]\x1b[0m failed to start: ${err.message}`);
    shutdown();
  });
  child.stdout.on("data", (c) => tag(t, process.stdout, c));
  child.stderr.on("data", (c) => tag(t, process.stderr, c));
  child.on("exit", (code) => {
    if (shuttingDown) return;
    console.log(`\x1b[${t.color}m[${t.label}]\x1b[0m exited with code ${code}. Stopping the rest.`);
    shutdown();
  });
  children.push(child);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try { c.kill("SIGINT"); } catch { /* already gone */ }
  }
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
