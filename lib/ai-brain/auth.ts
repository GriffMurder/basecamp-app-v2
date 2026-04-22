/**
 * AI Brain auth helper — checks AI_BRAIN_TOKEN bearer if set.
 */
export function requireBrainAuth(req: Request): Response | null {
  const token = process.env.AI_BRAIN_TOKEN?.trim() ?? "";
  if (!token) return null; // no token configured — open
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${token}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}