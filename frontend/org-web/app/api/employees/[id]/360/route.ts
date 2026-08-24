import { forward } from "@/lib/bff";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const qs = new URL(req.url).searchParams.toString();
  return forward(`/employees/${id}/360${qs ? `?${qs}` : ""}`);
}
