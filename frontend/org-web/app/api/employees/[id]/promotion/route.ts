import { forward } from "@/lib/bff";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forward(`/employees/${id}/promotion`, { method: "POST", body: await req.json().catch(() => ({})), fallbackError: "Could not raise the promotion." });
}
