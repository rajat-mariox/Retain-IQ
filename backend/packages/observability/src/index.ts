import pino from "pino";

export * from "./metrics.js";
export * from "./ops-server.js";
export * from "./process-handlers.js";

export type Logger = pino.Logger;

export function createLogger(service: string, level = "info"): Logger {
  return pino({
    level,
    base: {
      service,
    },
    redact: {
      paths: [
        "req.headers.authorization",
        "password",
        "passwordHash",
        "accessToken",
        "refreshToken",
        "oauthToken",
      ],
      remove: true,
    },
  });
}

