import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestContext } from "@retainiq/contracts";

export const requestContextStorage = new AsyncLocalStorage<Partial<RequestContext>>();

export function getRequestContext(): Partial<RequestContext> {
  return requestContextStorage.getStore() ?? {};
}

export function requireTenantContext(): RequestContext {
  const context = requestContextStorage.getStore();

  if (!context?.orgId || !context.userId || !context.requestId) {
    throw new Error("Tenant context is required for this operation.");
  }

  return context as RequestContext;
}

