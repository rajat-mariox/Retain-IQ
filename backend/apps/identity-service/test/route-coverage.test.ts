import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Route-coverage guard.
 *
 * PermissionGuard only enforces when a route carries @RequirePermissions — a
 * route without it is reachable by any authenticated member with no permission
 * check. That's fine for login and self-service routes, but it means a new
 * route that SHOULD be permission-gated can ship unprotected by simple omission.
 *
 * This test makes the intent explicit: every HTTP route in identity-service
 * must declare EITHER @RequirePermissions (locked to a permission) OR
 * @PublicRoute("reason") (deliberately open). A route with neither is treated
 * as an oversight and fails, so the open-by-default gap can't silently grow.
 *
 * Two kinds of controller are excluded, because the org PermissionGuard model
 * doesn't apply to them:
 *  - platform-admin: super-admins via PlatformAuthGuard, a separate auth world.
 *  - infra endpoints with no AuthGuard at all (health, metrics) — open by
 *    design and not part of the tenant request flow.
 */

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...controllerFiles(p));
    else if (entry.endsWith(".controller.ts")) out.push(p);
  }
  return out;
}

const METHOD = /^\s*@(Get|Post|Patch|Put|Delete)\s*\(/;
const GUARD = /@RequirePermissions|@PublicRoute/;
// A handler method line (ends the decorator block for a route): an identifier
// followed by "(", not itself a decorator.
const HANDLER = /^\s*(?:async\s+)?[a-zA-Z_][\w]*\s*\(/;

interface Route {
  file: string;
  line: number;
  signature: string;
}

/** Every route in the tree that has neither a permission nor a public marker. */
function findUncoveredRoutes(): Route[] {
  const uncovered: Route[] = [];
  for (const file of controllerFiles(SRC)) {
    if (file.includes("platform-admin")) continue; // separate super-admin auth
    const source = readFileSync(file, "utf8");
    // Infra endpoints (health, metrics) have no AuthGuard and aren't part of the
    // tenant permission model — skip the whole file.
    if (!source.includes("AuthGuard")) continue;
    const rel = relative(SRC, file).split(sep).join("/");
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!METHOD.test(lines[i])) continue;
      // Collect the route's decorators up to (and including) its handler line —
      // in NestJS the guard decorator may sit above OR below the @Get(...).
      let j = i;
      let block = lines[i];
      while (j + 1 < lines.length && !HANDLER.test(lines[j + 1])) {
        j++;
        block += "\n" + lines[j];
      }
      if (j + 1 < lines.length) block += "\n" + lines[j + 1];
      if (!GUARD.test(block)) uncovered.push({ file: rel, line: i + 1, signature: lines[i].trim() });
    }
  }
  return uncovered;
}

test("every identity route declares its access intent (a permission or @PublicRoute)", () => {
  const uncovered = findUncoveredRoutes();
  const report = uncovered.map((r) => `  ${r.file}:${r.line}  ${r.signature}`).join("\n");
  assert.equal(
    uncovered.length,
    0,
    `\n${uncovered.length} route(s) have neither @RequirePermissions nor @PublicRoute — ` +
      `add a permission if they should be gated, or @PublicRoute("why") if they're open on purpose:\n${report}\n`,
  );
});
