import { forward } from "@/lib/bff";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forward(`/employees/${id}/certifications`);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forward(`/employees/${id}/certifications`, { method: "POST", body: await req.json().catch(() => ({})), fallbackError: "Could not add the certification." });
}
