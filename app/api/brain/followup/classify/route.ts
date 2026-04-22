import { requireBrainAuth } from "@/lib/ai-brain/auth";
import { runFollowupClassify, type FollowupPayload } from "@/lib/ai-brain/engine";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const deny = requireBrainAuth(req);
  if (deny) return deny;
  const body = await req.json() as FollowupPayload;
  return Response.json(runFollowupClassify(body));
}