import { forward } from "@/lib/bff";

/** One-time code the panel hands to the desktop agent via retainiq://login?code=… */
export async function POST() {
  return forward("/auth/agent/link-code", { method: "POST", body: {}, fallbackError: "Couldn't prepare the agent sign-in." });
}
