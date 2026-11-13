import { forward } from "@/lib/bff";

/** Is the caller tracked, and is their desktop agent running right now? */
export async function GET() {
  return forward("/auth/agent/status", { fallbackError: "Couldn't read the agent status." });
}
