// Re-exported from observability so Nest services and plain workers share one
// implementation (observability has no framework dependency).
export { installProcessErrorHandlers } from "@retainiq/observability";
