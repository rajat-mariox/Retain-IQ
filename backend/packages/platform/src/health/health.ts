import { ServiceUnavailableException } from "@nestjs/common";

export type HealthCheck = () => Promise<unknown>;

export type HealthReport = {
  status: "ok" | "unavailable";
  checks: Record<string, "ok" | "down">;
};

/**
 * Runs dependency checks for a readiness probe. Each check is awaited
 * independently; if any fails the probe throws 503 (ServiceUnavailable) with
 * the per-dependency breakdown, so Kubernetes stops routing traffic to a pod
 * that cannot reach its datastore/broker.
 */
export async function runHealthChecks(checks: Record<string, HealthCheck>): Promise<HealthReport> {
  const entries = await Promise.all(
    Object.entries(checks).map(async ([name, check]): Promise<[string, "ok" | "down"]> => {
      try {
        await check();
        return [name, "ok"];
      } catch {
        return [name, "down"];
      }
    }),
  );

  const result = Object.fromEntries(entries) as Record<string, "ok" | "down">;
  const healthy = entries.every(([, status]) => status === "ok");

  if (!healthy) {
    throw new ServiceUnavailableException({ status: "unavailable", checks: result });
  }

  return { status: "ok", checks: result };
}
