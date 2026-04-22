/**
 * Returns true if the request carries a valid CRON_SECRET bearer token.
 * Returns false if missing or invalid.
 */
export function verifyCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return provided === secret;
}
