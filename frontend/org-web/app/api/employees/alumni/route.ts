import { forward } from "@/lib/bff";

export async function GET(req: Request) {
  const qs = new URL(req.url).searchParams.toString();
  return forward(`/employees/alumni${qs ? `?${qs}` : ""}`);
}
