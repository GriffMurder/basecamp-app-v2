# Ops deployment

Checked 2026-10-12. Commit SHAs move. The domain and platform mapping below is the durable fact.

This note is the same file in `GriffMurder/taskbullet-web` and `GriffMurder/basecamp-app-v2`. It changes no application code.

## Which deploy serves the live ops dashboard

The live ops dashboard is `https://ops.taskbullet.com`.

It is served by GitHub `GriffMurder/basecamp-app`, branch `main`, on Render service `ops-taskbullet-web` (FastAPI, uvicorn).

Checked evidence:

- DNS: `ops.taskbullet.com` CNAME `ops-taskbullet-web-3cbd.onrender.com`.
- `GET https://ops.taskbullet.com/health` returned `200` and `{"status":"ok"}`, with `x-render-origin-server: uvicorn` and a `rndr-id`.
- `GET /` returned `302` to `/auth/recover?next=/`.
- `GET /internal/hours` without a token returned `403` JSON from that same uvicorn host.
- GitHub deployments for SHA `b510c684` (`fix(ops): stop a repeated Basecamp page`) succeeded on 2026-10-12 for `main - ops-taskbullet-web` (22:23:07Z), `main - ops-celery-worker` (22:22:58Z), `main - ops-celery-beat` (22:22:55Z), and `main - ops-ai-brain` (22:22:50Z).
- `render.yaml` in that repo names `ops-taskbullet-web` as the public FastAPI service and sets `APP_BASE_URL` to `https://ops.taskbullet.com`.

`ops.orcarw.com` is the Orca hostname on that same FastAPI app. `render.yaml` attaches the domain to `ops-taskbullet-web`. A live `GET /health` returned the same uvicorn and `rndr-id` headers. Public DNS for that host is Cloudflare-proxied A records, so the Render CNAME is not visible the way it is for `ops.taskbullet.com`.

`basecamp-app-v2` does not serve this host. Details are in the section below.

## Domain map

| Host | What it serves | Repo | Production branch | Platform |
| --- | --- | --- | --- | --- |
| `ops.taskbullet.com` | Ops dashboard, `/internal/hours`, staff auth | `GriffMurder/basecamp-app` | `main` | Render `ops-taskbullet-web` |
| `ops.orcarw.com` | Same app, Orca host | `GriffMurder/basecamp-app` | `main` | Render `ops-taskbullet-web` (Cloudflare-proxied DNS) |
| `taskbullet.com`, `www.taskbullet.com` | Customer site, including `/admin/growth` | `GriffMurder/taskbullet-web` | `main` | Vercel project `taskbullet-web` |
| `taskbullet-web.vercel.app` | Same production deployment | `GriffMurder/taskbullet-web` | `main` | Vercel |
| no custom domain | Next.js ops port | `GriffMurder/basecamp-app-v2` | `master` | No current Vercel project |

Vercel account `griffmurder`, team `griffmurders-projects`, checked with `vercel whoami`, `vercel project ls`, and `vercel domains ls`.

Projects on that team: `straws-website`, `orca`, `returnflowhq`, `taskbullet-web`, `likelihood`, `next.taskbullet`, `taskbullet-chrono`.

Domains on that team: `strawssoda.com`, `orcarw.com`, `returnflowhq.com`, `taskbullet.com`. `ops.taskbullet.com` is not a Vercel domain.

`vercel project inspect taskbullet-web` and the project API show Next.js, GitHub repo `GriffMurder/taskbullet-web`, production branch `main`. Production aliases at this check: `taskbullet.com`, `www.taskbullet.com`, `taskbullet-web.vercel.app`, `taskbullet-web-griffmurders-projects.vercel.app`, `taskbullet-web-git-main-griffmurders-projects.vercel.app`. The ready production deployment was SHA `a3057833` (`fix(ads): never let the watchdog pause Google campaigns`). Live `https://taskbullet.com/` returned `Server: Vercel` and `X-Powered-By: Next.js`. `www.taskbullet.com` CNAMEs to `d7ac9369345c0ddc.vercel-dns-017.com`.

`next.taskbullet` is a separate Vercel project. Inspect showed no Git link. Its production aliases are only `*.vercel.app`, and the latest production deployment was `ERROR` (commit message `fix(ai): heal orphan work shells and atomic chat-yes dispatch`, SHA `896ebe45`). That project is neither the ops dashboard nor `basecamp-app-v2`.

## basecamp-app-v2

`GriffMurder/basecamp-app-v2` default branch is `master`. Tip at this check: `c72c699` (2026-05-04, `Update auth.config.ts`). The checkout has no `.vercel` directory. `package.json` `"name"` is `basecamp-app`. `next.config.ts` sets security headers and does not bind a hostname. `app/api/admin/stats/route.ts` includes a JSON field `site: "ops.taskbullet.com"`. That field is a label in the response. It does not attach the domain.

Vercel GitHub deployments for this repo run through 2026-04-24 (SHA `4d8d7df5`). The `vercel[bot]` status on 2026-04-27 marked environment `Production – basecamp-app-v2` success at `https://basecamp-app-v2-5asox50om-griffmurders-projects.vercel.app`. On 2026-10-12 that URL, `https://basecamp-app-v2.vercel.app`, and `https://basecamp-app-v2-griffmurders-projects.vercel.app` returned `X-Vercel-Error: DEPLOYMENT_NOT_FOUND`. `vercel api /v9/projects/basecamp-app-v2` returned 404. A project search for `basecamp` returned an empty list.

This app has no `/internal/hours` route. The live hours API is the FastAPI service on Render.

## How taskbullet-web reaches ops

taskbullet-web has no source reference to `basecamp-app-v2`.

Hours, capacity, debit, buckets, work events, and mission SMS use `OPS_API_BASE` (fallback `OPS_BASE_URL`) in `src/lib/ops-client.ts`. Calls include `GET /internal/hours`, `POST /internal/hours/debit`, `POST /internal/buckets`, `POST /internal/capacity`, work-opened and work-closed, and `POST /internal/sms`.

`.env.example` documents `OPS_API_BASE="https://ops.taskbullet.com"`. The Production environment on Vercel project `taskbullet-web` has `OPS_API_BASE` set to that same URL. `OPS_INTERNAL_TOKEN` is set there. Production env has no `INNGEST_*` variables.

`next.config.ts` rewrites are marketing permalinks (`/taskbullet-terms-of-service` and WordPress-style paths). They do not proxy ops paths.

`/admin/growth` is a page in this repo. It renders `DeliveryScoreboardPanel`, which imports `src/lib/tasks/delivery-csat.ts`.

## Where cron and Inngest run

### Live ops (`basecamp-app`)

Schedules run on Render service `ops-celery-beat` (`celery -A app.workers beat`). Celery timezone is `America/Chicago` (`app/workers.py`). The schedule is `app/workers_beat_schedule.py`. Tasks run on `ops-celery-worker`. The private AI service is `ops-ai-brain`.

Daily ops scores are Celery task `app.workers.run_daily_scoring`, beat key `daily-scoring`, Monday–Friday 08:07 America/Chicago.

`basecamp-app` has no Inngest client. Inngest does not schedule the live ops dashboard.

### `taskbullet.com` (`taskbullet-web`)

Schedules run as Vercel Cron on project `taskbullet-web`, from `vercel.json`. Vercel cron expressions are UTC.

The growth-page customer-health job is `/api/cron/customer-health-sync` at `30 7 * * *` (07:30 UTC). Hours-low email is `/api/cron/hours-low-alert` at `0 8 * * *`.

This repo has no Inngest dependency and no `/api/inngest` route.

### `basecamp-app-v2` (not the live host)

`vercel.json` declares six crons that would hit this Next app if a Vercel project were deploying it:

| Path | Schedule |
| --- | --- |
| `/api/cron/sla` | `*/5 * * * *` |
| `/api/cron/overdue` | `*/15 * * * *` |
| `/api/cron/daily-ops` | `5 8 * * 1-5` |
| `/api/cron/daily-scoring` | `7 8 * * 1-5` |
| `/api/cron/sync-people` | `0 2 * * *` |
| `/api/cron/weekly-ops` | `20 9 * * 1` |

Those handlers send Inngest events. `/api/cron/daily-scoring` sends `tb/daily-scoring.requested`. No function in this repo listens for that event name. `inngest/functions/daily-scoring.ts` has its own Inngest cron `7 8 * * 1-5` (file comment: UTC).

`app/api/inngest/route.ts` serves the Inngest client `basecamp-app`. `inngest/functions/score-compute.ts` schedules `score-compute` as `7 13 * * 1-5` (file comment: Monday–Friday 08:07 America/Chicago) and also on `tb/score-compute.requested`.

Those Vercel crons and Inngest functions run only while this Next app is deployed and Inngest is registered to `/api/inngest`. The Vercel project is gone, so they are not the jobs behind `ops.taskbullet.com`.

## Growth-page scoreboard and ops scores

The growth page and the ops dashboard compute different scores. `/admin/growth` does not read ops `scores_daily`.

### Delivery Quality / VA Scoreboard

`src/app/admin/growth/page.tsx` renders `DeliveryScoreboardPanel`. The panel calls `getLiveDeliveryCsat` and `getVaDeliveryScoreboard` in `src/lib/tasks/delivery-csat.ts`.

Both functions read taskbullet-web `PendingTask` rows with `vaCompletedAt` in the last 30 days, limited to active clients that have `firstPaidAt`. The summary source is `live_delivery_feedback`: accept and rework counts, optional 1–5 stars, a 0–100 CSAT from explicit ratings when the sample is large enough, first-pass accept rate, on-time rate, and median cycle hours.

The same helpers feed the growth brief (`src/lib/admin/growth-decision-context.ts`) and effectiveness learning. They do not call `OPS_API_BASE`.

### Customer Health on the same page

The Customer Health block is `ClientHealthSnapshot` data from `syncCustomerHealth` in `src/lib/admin/customer-health.ts`, written by the Vercel cron above.

Inputs are ops bucket utilisation (`getClientHours`, which calls the ops hours API), Basecamp activity, subscription status, and tenure. Tiers are low at 75 and above, medium 50–74, high 25–49, and critical under 25. The module describes this as a retention signal for human action.

Ops hours are one input. This number is a different calculation from ops `client_health`.

### Ops scores

On the live ops app, `scores_daily` stores the ops scores, including `client_health` and VA reliability. Celery `run_daily_scoring` writes them. Command Center at-risk counts the latest `client_health` under 70. Those pages are on `ops.taskbullet.com`.

`basecamp-app-v2` contains a port of that job in `inngest/functions/score-compute.ts` (`va_reliability`, `va_capacity_index`, `client_health`, `client_difficulty`) and a narrower VA pass in `inngest/functions/daily-scoring.ts`. The Prisma model maps to `scores_daily`. That port is not the process on the live Render beat. This check found no deployed app running it.

## How to re-check

```bash
vercel whoami
vercel project ls
vercel domains ls
vercel project inspect taskbullet-web
```

```bash
nslookup ops.taskbullet.com
curl -sSI https://ops.taskbullet.com/health
curl -sSI https://taskbullet.com/
```

GitHub deployments: `repos/GriffMurder/basecamp-app/deployments`, environments `main - ops-taskbullet-web`, `main - ops-celery-worker`, `main - ops-celery-beat`, and `main - ops-ai-brain`.
