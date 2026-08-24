import { forward } from "@/lib/bff";

export async function GET() {
  return forward(`/employees/workforce-settings`);
}

export async function PATCH(req: Request) {
  return forward(`/employees/workforce-settings`, { method: "PATCH", body: await req.json().catch(() => ({})), fallbackError: "Could not update settings." });
}
