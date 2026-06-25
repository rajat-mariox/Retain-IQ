// Side-effect module: load the monorepo-root `.env` for local/host runs.
//
// Import this FIRST in a service entrypoint (before any module that calls
// loadConfig()), e.g.  import "@retainiq/config/env";
//
// No-op in production: containers/orchestrators inject real env vars and the
// runtime image sets NODE_ENV=production, so .env is neither present nor wanted.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

if (process.env.NODE_ENV !== "production") {
  // Walk up from cwd to the nearest .env. When run via `npm -w <pkg>` the cwd is
  // the package dir, so the repo-root .env is a few levels up.
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
}
