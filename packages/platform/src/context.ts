/**
 * Supplies cross-cutting log/error bindings for the current request
 * (requestId, traceId, orgId, userId, ...). Each service wires its own
 * AsyncLocalStorage-backed getter; platform stays framework-state agnostic.
 */
export type ContextProvider = () => Record<string, unknown>;

export function readContext(provider: ContextProvider | undefined): Record<string, unknown> {
  if (!provider) {
    return {};
  }
  try {
    return provider();
  } catch {
    return {};
  }
}
