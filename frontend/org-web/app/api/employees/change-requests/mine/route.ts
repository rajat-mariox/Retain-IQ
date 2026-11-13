import { forward } from "@/lib/bff";

export async function GET() {
  return forward(`/employees/change-requests/mine`);
}
