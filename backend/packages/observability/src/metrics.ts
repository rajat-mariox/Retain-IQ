import client from "prom-client";

export type Metrics = {
  registry: client.Registry;
  httpRequestsTotal: client.Counter<"method" | "route" | "status">;
  httpRequestDuration: client.Histogram<"method" | "route" | "status">;
  /** Generic gauge for service-specific values (outbox depth, consumer lag, ...). */
  gauge: (name: string, help: string, labelNames?: string[]) => client.Gauge<string>;
  /** Generic counter (events consumed, DLQ routed, ...). */
  counter: (name: string, help: string, labelNames?: string[]) => client.Counter<string>;
  render: () => Promise<string>;
  contentType: string;
};

/**
 * Creates an isolated Prometheus registry with default process metrics plus the
 * standard RED HTTP metrics. Each service owns one Metrics instance; the
 * `service` label is attached to every series so dashboards can slice per
 * service (and the docs' "tenant-level metrics from day one" can be layered on).
 */
export function createMetrics(service: string): Metrics {
  const registry = new client.Registry();
  registry.setDefaultLabels({ service });
  client.collectDefaultMetrics({ register: registry });

  const httpRequestsTotal = new client.Counter({
    name: "http_requests_total",
    help: "Total HTTP requests.",
    labelNames: ["method", "route", "status"] as const,
    registers: [registry],
  });

  const httpRequestDuration = new client.Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds.",
    labelNames: ["method", "route", "status"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  return {
    registry,
    httpRequestsTotal,
    httpRequestDuration,
    gauge: (name, help, labelNames = []) =>
      new client.Gauge({ name, help, labelNames, registers: [registry] }),
    counter: (name, help, labelNames = []) =>
      new client.Counter({ name, help, labelNames, registers: [registry] }),
    render: () => registry.metrics(),
    contentType: registry.contentType,
  };
}
