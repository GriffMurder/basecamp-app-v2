import { requireBrainAuth } from "@/lib/ai-brain/auth";
import { runCommsDraft, type CommsDraftRequest } from "@/lib/ai-brain/engine";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const deny = requireBrainAuth(req);
  if (deny) return deny;
  const body = await req.json() as CommsDraftRequest;
  if (!body.customer_text) {
    return Response.json({ error: "customer_text is required" }, { status: 400 });
  }
  return Response.json(runCommsDraft(body));
}