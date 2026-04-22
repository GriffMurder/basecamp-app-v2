/**
 * lib/clockify.ts
 * Clockify REST API v1 client — mirrors app/clockify_client.py.
 *
 * Rate limit: 10 req/sec  |  Retries: 3 with exponential back-off
 */

const BASE_URL = "https://api.clockify.me/api/v1";
const REPORTS_URL = "https://reports.api.clockify.me/v1";

export interface ClockifyTimeEntry {
  id: string;
  description: string;
  projectId: string;
  taskId: string | null;
  tagIds: string[];
  timeInterval: { start: string; end: string | null; duration: string | null };
  userId: string;
}

export interface ClockifyProject {
  id: string;
  name: string;
  clientId: string;
  archived: boolean;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function headers(): Record<string, string> {
  const apiKey = process.env.CLOCKIFY_API_KEY;
  if (!apiKey) throw new Error("CLOCKIFY_API_KEY is not set");
  return { "X-Api-Key": apiKey, "Content-Type": "application/json" };
}

function workspaceId(): string {
  const id = process.env.CLOCKIFY_WORKSPACE_ID;
  if (!id) throw new Error("CLOCKIFY_WORKSPACE_ID is not set");
  return id;
}

async function request<T>(
  method: string,
  url: string,
  body?: object,
  retries = 3
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 429 || res.status >= 500) {
      if (attempt === retries) {
        throw new Error(`Clockify ${method} ${url}: ${res.status} after ${retries} retries`);
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      continue;
    }

    if (!res.ok) throw new Error(`Clockify ${method} ${url}: ${res.status}`);
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }
  throw new Error("Clockify request exhausted retries");
}

async function paginate<T>(baseUrl: string): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  while (true) {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const batch = await request<T[]>("GET", `${baseUrl}${sep}page=${page}&page-size=50`);
    if (!batch.length) break;
    all.push(...batch);
    if (batch.length < 50) break;
    page++;
  }
  return all;
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function getProjects(): Promise<ClockifyProject[]> {
  const ws = workspaceId();
  return paginate<ClockifyProject>(`${BASE_URL}/workspaces/${ws}/projects`);
}

export async function getProject(projectId: string): Promise<ClockifyProject> {
  const ws = workspaceId();
  return request<ClockifyProject>(
    "GET",
    `${BASE_URL}/workspaces/${ws}/projects/${projectId}`
  );
}

// ── Time entries ──────────────────────────────────────────────────────────────

export interface TimeEntryFilter {
  userId?: string;
  projectId?: string;
  start?: string; // ISO date
  end?: string;
}

export async function getTimeEntries(filter?: TimeEntryFilter): Promise<ClockifyTimeEntry[]> {
  const ws = workspaceId();
  const params = new URLSearchParams();
  if (filter?.start) params.set("start", filter.start);
  if (filter?.end) params.set("end", filter.end);
  if (filter?.projectId) params.set("project", filter.projectId);

  const userId = filter?.userId ?? "me";
  const qs = params.toString() ? `?${params}` : "";
  return paginate<ClockifyTimeEntry>(
    `${BASE_URL}/workspaces/${ws}/user/${userId}/time-entries${qs}`
  );
}

export async function addTimeEntry(
  userId: string,
  entry: {
    description: string;
    projectId: string;
    tagIds?: string[];
    start: string;
    end?: string;
  }
): Promise<ClockifyTimeEntry> {
  const ws = workspaceId();
  return request<ClockifyTimeEntry>(
    "POST",
    `${BASE_URL}/workspaces/${ws}/user/${userId}/time-entries`,
    entry
  );
}

// ── Reports ───────────────────────────────────────────────────────────────────

export async function getSummaryReport(params: {
  dateRangeStart: string;
  dateRangeEnd: string;
  summaryFilter?: object;
}): Promise<object> {
  const ws = workspaceId();
  return request<object>(
    "POST",
    `${REPORTS_URL}/workspaces/${ws}/reports/summary`,
    { ...params, exportType: "JSON" }
  );
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function getWorkspaceUsers(): Promise<
  { id: string; name: string; email: string }[]
> {
  const ws = workspaceId();
  return paginate<{ id: string; name: string; email: string }>(
    `${BASE_URL}/workspaces/${ws}/users`
  );
}

// ── Tags ──────────────────────────────────────────────────────────────────────

export async function getTags(): Promise<{ id: string; name: string }[]> {
  const ws = workspaceId();
  return paginate<{ id: string; name: string }>(
    `${BASE_URL}/workspaces/${ws}/tags`
  );
}