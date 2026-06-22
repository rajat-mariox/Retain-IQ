import { createServer, type Server, type ServerResponse } from "node:http";
import type { Logger } from "./index.js";
import type { Metrics } from "./metrics.js";

export type OpsServerOptions = {
  port: number;
  logger: Logger;
  metrics?: Metrics;
  /** Returns true when the process can serve / do work (deps reachable). */
  readiness?: () => Promise<boolean>;
};

/**
 * Minimal HTTP server for non-Nest workers exposing Kubernetes probe endpoints
 * and Prometheus metrics:
 *   GET /health/live  -> process is up (always 200)
 *   GET /health/ready -> dependencies reachable (200/503)
 *   GET /metrics      -> Prometheus exposition
 */
export function startOpsServer(options: OpsServerOptions): Server {
  const { port, logger, metrics, readiness } = options;

  const server = createServer((req, res) => {
    const url = req.url ?? "/";

    if (url === "/health/live") {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    if (url === "/health/ready") {
      const check = readiness ? readiness() : Promise.resolve(true);
      check
        .then((ok) => sendJson(res, ok ? 200 : 503, { status: ok ? "ok" : "unavailable" }))
        .catch(() => sendJson(res, 503, { status: "unavailable" }));
      return;
    }

    if (url === "/metrics" && metrics) {
      metrics
        .render()
        .then((body) => {
          res.writeHead(200, { "content-type": metrics.contentType });
          res.end(body);
        })
        .catch(() => sendJson(res, 500, { status: "error" }));
      return;
    }

    sendJson(res, 404, { status: "not_found" });
  });

  server.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "ops server listening");
  });

  return server;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
