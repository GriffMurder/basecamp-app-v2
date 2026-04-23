/**
 * Cloudflare Email Routing API client
 * Wraps destination address + routing rule management.
 *
 * Required env vars:
 *   CLOUDFLARE_API_TOKEN   - API token with "Email Routing: Edit" permission
 *   CLOUDFLARE_ACCOUNT_ID  - Cloudflare account ID
 *   CLOUDFLARE_ZONE_ID     - Zone ID for the domain being routed
 */

const CF_BASE = "https://api.cloudflare.com/client/v4";
const TIMEOUT_MS = 15_000;

function headers(): Record<string, string> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not set");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function cfFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${CF_BASE}${path}`, {
      ...options,
      headers: { ...headers(), ...(options.headers as Record<string, string> | undefined) },
      signal: controller.signal,
    });
    const data = await res.json() as { success: boolean; result?: T; errors?: { message: string }[] };
    if (!data.success) {
      const msg = data.errors?.map((e) => e.message).join("; ") ?? "Cloudflare API error";
      throw new Error(msg);
    }
    return data.result as T;
  } finally {
    clearTimeout(timer);
  }
}

// ── Destination Addresses ─────────────────────────────────────────────────

export type CfDestination = {
  tag: string;
  email: string;
  verified: string | null;
  created: string;
  modified: string;
};

export async function listDestinationAddresses(): Promise<CfDestination[]> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is not set");
  const result = await cfFetch<CfDestination[]>(
    `/accounts/${accountId}/email/routing/addresses`
  );
  return result ?? [];
}

export async function createDestinationAddress(email: string): Promise<CfDestination> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is not set");
  return cfFetch<CfDestination>(
    `/accounts/${accountId}/email/routing/addresses`,
    { method: "POST", body: JSON.stringify({ email }) }
  );
}

export async function deleteDestinationAddress(tag: string): Promise<void> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is not set");
  await cfFetch(`/accounts/${accountId}/email/routing/addresses/${tag}`, {
    method: "DELETE",
  });
}

// ── Routing Rules ─────────────────────────────────────────────────────────

export type CfRule = {
  tag: string;
  name: string;
  enabled: boolean;
  priority: number;
  matchers: { type: string; field?: string; value?: string }[];
  actions: { type: string; value?: string[] }[];
  created: string;
  modified: string;
};

export async function listRoutingRules(): Promise<CfRule[]> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!zoneId) throw new Error("CLOUDFLARE_ZONE_ID is not set");
  const result = await cfFetch<CfRule[]>(
    `/zones/${zoneId}/email/routing/rules`
  );
  return result ?? [];
}

export async function createRoutingRule(params: {
  name: string;
  matchers: CfRule["matchers"];
  actions: CfRule["actions"];
  enabled?: boolean;
  priority?: number;
}): Promise<CfRule> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!zoneId) throw new Error("CLOUDFLARE_ZONE_ID is not set");
  return cfFetch<CfRule>(`/zones/${zoneId}/email/routing/rules`, {
    method: "POST",
    body: JSON.stringify({ enabled: true, priority: 0, ...params }),
  });
}

export async function deleteRoutingRule(ruleTag: string): Promise<void> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!zoneId) throw new Error("CLOUDFLARE_ZONE_ID is not set");
  await cfFetch(`/zones/${zoneId}/email/routing/rules/${ruleTag}`, {
    method: "DELETE",
  });
}
