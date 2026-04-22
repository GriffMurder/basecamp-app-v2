import { POLICY } from "@/lib/ai-brain/policy";
export const runtime = "nodejs";
export function GET() {
  return Response.json({
    ok: true,
    service: "tb-ai-brain",
    org_mode: "taskbullet",
    policy_loaded: true,
    policy_hash: "embedded",
    skill_buckets: Object.keys(POLICY.routing.skill_buckets),
  });
}