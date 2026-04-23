/**
 * lib/basecamp.ts
 * Basecamp 3 REST API client with OAuth2 token refresh.
 *
 * Token storage strategy:
 *   - Primary: `BasecampPersonToken` table (person-specific posting)
 *   - Fallback: BASECAMP_TOKEN env (service account / scrape token)
 */

const API_BASE = "https://3.basecampapi.com";
const TOKEN_URL = "https://launchpad.37signals.com/authorization/token";
const USER_AGENT = `TaskBullet-Ops/1.0 (${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001"})`;

export interface BasecampTodoItem {
  id: number;
  title: string;
  description: string;
  completed: boolean;
  completion_url: string;
  due_on: string | null;
  assignees: { id: number; name: string; email_address: string }[];
  creator: { id: number; name: string; email_address: string };
  parent: { id: number; title: string; url: string };
  bucket: { id: number; name: string };
  app_url: string;
  url: string;
  created_at: string;
  updated_at: string;
  comments_count: number;
  comments_url: string;
}

export interface BasecampComment {
  id: number;
  content: string;
  creator: { id: number; name: string; email_address: string };
  created_at: string;
}

// ── Token management ──────────────────────────────────────────────────────────

async function refreshServiceToken(): Promise<string | null> {
  const clientId = process.env.BASECAMP_CLIENT_ID;
  const clientSecret = process.env.BASECAMP_CLIENT_SECRET;
  const refreshToken = process.env.BASECAMP_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return process.env.BASECAMP_TOKEN ?? null;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      type: "refresh",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) return process.env.BASECAMP_TOKEN ?? null;
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// ── Core request ─────────────────────────────────────────────────────────────

async function bcFetch(
  path: string,
  token: string,
  opts: RequestInit = {}
): Promise<Response> {
  const accountId = process.env.BASECAMP_ACCOUNT_ID;
  if (!accountId) throw new Error("BASECAMP_ACCOUNT_ID is not set");

  const url = `${API_BASE}/${accountId}${path}`;
  return fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Fetch a single todo by its numeric ID. */
export async function getTodo(
  todoId: number,
  projectId: number,
  token?: string
): Promise<BasecampTodoItem> {
  const tok = token ?? (await refreshServiceToken());
  if (!tok) throw new Error("No Basecamp access token available");

  const res = await bcFetch(`/projects/${projectId}/todos/${todoId}.json`, tok);
  if (!res.ok) throw new Error(`Basecamp getTodo ${todoId}: ${res.status}`);
  return res.json() as Promise<BasecampTodoItem>;
}

/** Fetch all todos in a todolist (paginates up to maxPages). */
export async function getTodosInList(
  projectId: number,
  todolistId: number,
  token?: string,
  maxPages = 10
): Promise<BasecampTodoItem[]> {
  const tok = token ?? (await refreshServiceToken());
  if (!tok) throw new Error("No Basecamp access token available");

  const all: BasecampTodoItem[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await bcFetch(
      `/projects/${projectId}/todolists/${todolistId}/todos.json?page=${page}`,
      tok
    );
    if (res.status === 404) break;
    if (!res.ok) throw new Error(`Basecamp getTodosInList page ${page}: ${res.status}`);
    const batch = (await res.json()) as BasecampTodoItem[];
    all.push(...batch);
    if (batch.length < 50) break; // Basecamp default page size = 50
  }
  return all;
}

/** Fetch comments on a todo. */
export async function getComments(
  projectId: number,
  recordingId: number,
  token?: string
): Promise<BasecampComment[]> {
  const tok = token ?? (await refreshServiceToken());
  if (!tok) throw new Error("No Basecamp access token available");

  const res = await bcFetch(
    `/projects/${projectId}/recordings/${recordingId}/comments.json`,
    tok
  );
  if (!res.ok) throw new Error(`Basecamp getComments ${recordingId}: ${res.status}`);
  return res.json() as Promise<BasecampComment[]>;
}

/** Post a comment to a todo on behalf of the service account. */
export async function postComment(
  projectId: number,
  todoId: number,
  content: string,
  token?: string
): Promise<BasecampComment> {
  const tok = token ?? (await refreshServiceToken());
  if (!tok) throw new Error("No Basecamp access token available");

  const res = await bcFetch(
    `/projects/${projectId}/recordings/${todoId}/comments.json`,
    tok,
    { method: "POST", body: JSON.stringify({ content }) }
  );
  if (!res.ok) throw new Error(`Basecamp postComment ${todoId}: ${res.status}`);
  return res.json() as Promise<BasecampComment>;
}

/** Mark a todo complete. */
export async function completeTodo(
  projectId: number,
  todoId: number,
  token?: string
): Promise<void> {
  const tok = token ?? (await refreshServiceToken());
  if (!tok) throw new Error("No Basecamp access token available");

  const res = await bcFetch(
    `/projects/${projectId}/todos/${todoId}/completion.json`,
    tok,
    { method: "POST" }
  );
  if (!res.ok && res.status !== 204)
    throw new Error(`Basecamp completeTodo ${todoId}: ${res.status}`);
}

/** Mark a todo incomplete. */
export async function uncompleteTodo(
  projectId: number,
  todoId: number,
  token?: string
): Promise<void> {
  const tok = token ?? (await refreshServiceToken());
  if (!tok) throw new Error("No Basecamp access token available");

  const res = await bcFetch(
    `/projects/${projectId}/todos/${todoId}/completion.json`,
    tok,
    { method: "DELETE" }
  );
  if (!res.ok && res.status !== 204)
    throw new Error(`Basecamp uncompleteTodo ${todoId}: ${res.status}`);
}

/** Reassign a todo to new assignee person IDs. */
export async function reassignTodo(
  projectId: number,
  todoId: number,
  assigneeIds: number[],
  token?: string
): Promise<BasecampTodoItem> {
  const tok = token ?? (await refreshServiceToken());
  if (!tok) throw new Error("No Basecamp access token available");

  const res = await bcFetch(`/projects/${projectId}/todos/${todoId}.json`, tok, {
    method: "PUT",
    body: JSON.stringify({ assignee_ids: assigneeIds }),
  });
  if (!res.ok) throw new Error(`Basecamp reassignTodo ${todoId}: ${res.status}`);
  return res.json() as Promise<BasecampTodoItem>;
}

export interface BasecampProjectEvent {
  id: number;
  type: string;
  content: string;
  excerpt?: string;
  creator: { id: number; name: string } | null;
  created_at: string;
  updated_at: string;
}

/**
 * Fetch recent recordings (events) for a Basecamp project.
 * Uses the /projects/:projectId/recordings.json endpoint (filtered by type=event).
 * `since` is an ISO-8601 UTC timestamp string to filter events after that time.
 */
export async function listProjectEvents(
  projectId: number,
  since?: string,
  token?: string
): Promise<BasecampProjectEvent[]> {
  const tok = token ?? (await refreshServiceToken());
  if (!tok) throw new Error("No Basecamp access token available");

  const all: BasecampProjectEvent[] = [];
  const types = ["Message", "Document", "Upload", "Comment"];

  for (const type of types) {
    let page = 1;
    while (page <= 3) {
      let path = `/projects/${projectId}/recordings.json?type=${type}&page=${page}`;
      if (since) path += `&since=${encodeURIComponent(since)}`;
      const res = await bcFetch(path, tok);
      if (res.status === 404) break;
      if (!res.ok) break;
      const batch = (await res.json()) as BasecampProjectEvent[];
      all.push(...batch);
      if (batch.length < 50) break;
      page++;
    }
  }
  return all;
}

/** Fetch all active projects (buckets) for the account. */
export async function getProjects(token?: string): Promise<
  { id: number; name: string; status: string }[]
> {
  const tok = token ?? (await refreshServiceToken());
  if (!tok) throw new Error("No Basecamp access token available");

  const all = [];
  for (let page = 1; page <= 5; page++) {
    const res = await bcFetch(`/projects.json?page=${page}`, tok);
    if (!res.ok) break;
    const batch = (await res.json()) as { id: number; name: string; status: string }[];
    all.push(...batch);
    if (batch.length < 50) break;
  }
  return all;
}

/** Exchange an authorization code for access + refresh tokens (OAuth callback). */
export async function exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      type: "web_server",
      client_id: process.env.BASECAMP_CLIENT_ID ?? "",
      client_secret: process.env.BASECAMP_CLIENT_SECRET ?? "",
      redirect_uri: process.env.BASECAMP_REDIRECT_URI ?? "",
      code,
    }),
  });
  if (!res.ok) throw new Error(`Basecamp token exchange failed: ${res.status}`);
  return res.json();
}