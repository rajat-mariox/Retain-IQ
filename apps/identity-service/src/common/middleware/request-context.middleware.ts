import { randomUUID } from "node:crypto";
import { Injectable, NestMiddleware } from "@nestjs/common";
import { requestContextStorage } from "../context/request-context.store.js";

type MiddlewareRequest = {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
};

type MiddlewareResponse = {
  setHeader(name: string, value: string): void;
};

type NextFunction = () => void;

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: MiddlewareRequest, res: MiddlewareResponse, next: NextFunction) {
    const requestId = getHeader(req, "x-request-id") ?? randomUUID();
    const traceId = getHeader(req, "x-trace-id") ?? requestId;

    res.setHeader("x-request-id", requestId);

    requestContextStorage.run(
      {
        requestId,
        traceId,
        ipAddress: req.ip,
        userAgent: getHeader(req, "user-agent") ?? "unknown",
      },
      next,
    );
  }
}

function getHeader(req: MiddlewareRequest, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
