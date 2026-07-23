import { SetMetadata } from "@nestjs/common";

export const PUBLIC_ROUTE_KEY = "public_route";

/**
 * Marks a route as deliberately open — it does not require a permission because
 * anyone (or any signed-in member) is meant to reach it: login, a person's own
 * data, self-service actions like raising your own leave request.
 *
 * This is an INTENT marker, not a security control — auth guards still apply.
 * Its purpose is to distinguish "no permission on purpose" from "someone forgot
 * to add one". The route-coverage check treats a route with neither
 * @RequirePermissions nor @PublicRoute as an oversight and fails the build, so
 * the open-by-default gap can't silently ship a new unprotected route.
 *
 * Pass a short reason so the intent is legible at the call site:
 *   @PublicRoute("employee raises their own leave")
 */
export function PublicRoute(reason: string) {
  return SetMetadata(PUBLIC_ROUTE_KEY, reason || true);
}
