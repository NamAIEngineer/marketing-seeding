# Jang Global Seeding System

![Marketing seeding dashboard overview](./docs/images/dashboard-overview.png)

*Documentation preview with synthetic sample values. It contains no live campaign, account, or lead data.*

This dashboard runs locally on each operator's machine. Each machine keeps its own state, tokens, and logs; data does not synchronize or appear in real time across machines. The repository contains source code, documentation, and the built frontend. Runtime campaign data, lead feeds, credentials, logs, and generated daily content bundles stay local and are excluded from Git.

## Getting started on a new machine

Requirements: Windows PowerShell, Git, Node.js 22 or later, and pnpm 10 or later.

```powershell
git clone https://github.com/DevAngular333/marketing-seeding.git
cd marketing-seeding
$env:AGENTIC_ROOT = (Resolve-Path ..\build-agentic-AI).Path # Set to your local control-plane folder
pnpm.cmd install
node src\cli.mjs init
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-SeedingDashboard.ps1
```

Open `http://127.0.0.1:4318`. On first launch, the app creates runtime state and random operator tokens in `%AGENTIC_ROOT%\.agentic\marketing-seeding`. Git ignores this directory. Run `node src\cli.mjs bootstrap-r19` if you want to create the sample R19 campaign, and `node src\cli.mjs status` to inspect the local state. `Get-SeedingDashboardStatus.ps1` checks whether the local server is ready. Keep the local runtime directory when updating the source if you want to preserve campaign history. On another machine, set `$env:AGENTIC_ROOT` to that machine's control-plane directory before starting the app; runtime data remains local to that machine.

By default, the server stores runtime data under `build-agentic-AI/.agentic/marketing-seeding` in the current user's home directory and reads the Auto-GTM feed under `build-agentic-AI/.agentic/gtm`. Set `AGENTIC_ROOT` to another local control-plane folder, or set `SEEDING_DATA_DIR` and `SEEDING_AUTO_GTM_FEED_FILE` to choose explicit local paths. Each machine keeps its own runtime state; GitHub does not synchronize campaign data. Do not commit those files or put token values in `.env.example`, documentation, or screenshots.

To rebuild the UI, run `pnpm.cmd install` and `pnpm.cmd build` inside `ui`, then copy the generated `ui\dist` files into `public`. A fresh clone can run immediately because the current frontend build is included in `public`.

## macOS desktop app

The repository also ships a native macOS app wrapper around the same local
Overview and API. It does not fork a second dashboard or copy runtime state into
the repository. Build and open it on macOS with Node.js 22 or newer:

```sh
sh desktop/build-macos.sh
open "desktop/dist/Marketing Seeding OS.app"
```

The app stores state and generated bearer tokens in
`~/Library/Application Support/Marketing Seeding OS`, serves only on
`127.0.0.1`, and opens the Overview in a native WebKit window. The packaged
source revision is recorded in the app resources. Listening, Camoufox, media,
and publication capabilities remain evidence-gated; unavailable runtimes are
reported as unavailable or UNKNOWN rather than presented as completed work.

## Architecture

```text
Product repo + verified media
          |
          v
 Campaign / audience brief
          |
          v
 Target registry + rules review
          |
          v
 Draft -> review -> approval -> guarded queue
          |
          v
 Manual/Orca publisher -> processing -> published evidence
          |
          v
 Metrics snapshots + interactions -> AI reply draft -> approval -> send evidence
```

Runtime state is an atomic JSON document at `%AGENTIC_ROOT%\.agentic\marketing-seeding\state.json` by default (or under `SEEDING_DATA_DIR`). Git ignores this directory. Every mutation increments a revision and appends an audit event.

The dashboard binds to loopback by default. All HTTP `POST` and `PATCH` routes require the
local operator bearer token stored at
`%AGENTIC_ROOT%\.agentic\marketing-seeding\operator-token` by default; the startup
script creates that token with a cryptographic RNG and injects it into the Node
child process. Both token files use protected Windows ACLs limited to the current
process identity, file owner, SYSTEM and local Administrators. This lets the
limited current-user Scheduled Task recover the service without granting broad
local-user access. Never copy a token into source, Markdown, logs or screenshots.
Draft automation uses a separate scoped token at
`%AGENTIC_ROOT%\.agentic\marketing-seeding\automation-token` by default; it cannot
approve, publish, or mark a reply/email as sent.


## Auto-GTM lead feed

The dashboard includes a read-only connector that displays leads from Auto-GTM. This repository does not bundle or run Auto-GTM. The connector reads a JSON feed from `SEEDING_AUTO_GTM_FEED_FILE`, defaulting to `.agentic/gtm/marketing-seeding-feed.json` under `AGENTIC_ROOT` (which defaults to `D:\build-agentic-AI` on this machine). Configure Auto-GTM separately and point the dashboard at its exported feed on the same machine. The dashboard does not discover leads or synchronize feed files between machines. If the feed is absent, the lead view reports that the integration is not configured; it does not fabricate lead records.

## Current R19 campaign

The bootstrap command registers:

1. Blender 3D Malaysia — needs review until a direct post permalink and verification evidence are imported.
2. Threads — needs review.
3. Reddit — target subreddit and its rules still need review.
4. Product Hunt — launch positioning and assets still need review.
5. Indie Hackers — build-log positioning and community rules still need review.
6. LinkedIn — professional-audience positioning still needs review.
7. Email opt-in — remains inactive until consent source and unsubscribe evidence are supplied.

The campaign accurately says the R19 film is a visual prototype and does not
claim physical-manufacturing qualification.


## Run

```powershell
pnpm.cmd install
node src\cli.mjs init
node src\cli.mjs bootstrap-r19
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-SeedingDashboard.ps1
```

Open `http://127.0.0.1:4318`. Start without a visible terminal:

```powershell
wscript.exe //B //NoLogo .\Start-SeedingDashboard-Hidden.vbs
```

For a VPS, keep the frontend and API on the same origin so the dashboard
continues to read the live `/api/dashboard` endpoint without build-time data.
Set `SEEDING_HOST=127.0.0.1` behind nginx (recommended) or explicitly use
`SEEDING_HOST=0.0.0.0` only with a firewall and TLS reverse proxy. Keep
`SEEDING_DATA_DIR`, `SEEDING_OPERATOR_TOKEN` and `SEEDING_AUTOMATION_TOKEN` in
the VPS environment; never place their values in the repository or frontend.

Check health:

```powershell
.\Get-SeedingDashboardStatus.ps1
node src\cli.mjs status
```

## Dashboard operator flow (24/7)

The dashboard refreshes local state every 60 seconds and keeps the next traffic
checkpoint visible for every published post. To enable mutation buttons, paste
the runtime operator token into the operator token field; it is verified against
`GET /api/operator/session` and kept only in that tab's `sessionStorage`.
Disconnecting or closing the tab removes the session copy.

Install the packaged daily production automation once:

```powershell
.\Install-DailyBlenderSeedingAutomation.ps1 -Time '09:00'
```

The installer is idempotent by automation name and writes only a non-secret
runtime receipt under `%AGENTIC_ROOT%/.agentic/marketing-seeding/daily-automation.json`. Orca
then creates one new render-only Blender artifact per day, verifies/hash-binds
the media, and creates channel-specific drafts in this dashboard. Drafts remain
approval-gated; the schedule never performs a final social-platform publish,
login, CAPTCHA, group join or reply send.

For an approved post, choose `Open Chrome and copy` to advance the guarded queue,
copy the channel-specific draft, and open the allowlisted platform URL in a new
Chrome tab. The operator reviews the live composer and performs the
final platform submit. After submission, choose `Record published permalink` to provide the specific
public URL and verification evidence before the dashboard records the post as
published. **Record traffic** captures finite nonnegative metric snapshots;
the traffic loop prioritizes open interactions and the 1h/24h/72h checkpoints.

The Campaign Manager also stores up to 50 deduplicated keywords per campaign,
an optional landing page, intent/locale metadata and verified keyword snapshots
(impressions, clicks, leads and rank). This supports a long-running organic
promotion loop with an Ads Manager-style control surface. Facebook Ads and
Google Ads are UX references only: this toolkit does not create paid campaigns,
set bids, attach billing or spend money.

This flow deliberately does not extract cookies/session storage, solve CAPTCHA,
join arbitrary communities, or auto-click a platform's final publish button.
For posts with stored permalinks, a read-only Orca automation may use the already
logged-in Chrome window to read counters that are visibly rendered. Every such
observation is bound to the exact permalink, timestamp, evidence text and a
real screenshot under `%AGENTIC_ROOT%/.agentic/marketing-seeding/evidence`. The server reads
that file and verifies its SHA-256 hash before accepting the observation;
outside, missing or mismatched files fail closed. Missing or ambiguous counters
remain `UNKNOWN`. Each check inspects impressions/views, reactions,
comments/replies, shares/reposts, clicks and leads. An unchanged value-and-
coverage set records collector health/evidence without appending a duplicate
metric snapshot; a changed value or coverage state appends a new snapshot.
Visible comments/replies are recorded only when the platform exposes a stable
`externalId`, and duplicate `postId + externalId` observations are idempotent.
The collector never drafts or sends replies.

Install the idempotent browser collector, scheduled once per day at 23:30
Asia/Saigon:

```powershell
.\Install-BrowserTrafficAutomation.ps1
```

It writes only a non-secret receipt under
`%AGENTIC_ROOT%/.agentic/marketing-seeding/browser-automation.json`. It never clicks reaction,
comment, share, follow, join, publish or send controls. Login walls and CAPTCHA
are recorded as unknown evidence for the operator to resolve. Dashboard
`browserCoverage` is the postcondition: every post with `status=published` and a
non-empty `publicationUrl` must have one recent observation inside the daily
window; scheduler completion alone is not PASS. Approved but unpublished posts
are not monitored.

## Optional official API traffic collection

The API connections table reports environment-variable names that are missing,
never their values. A published post also needs a platform `externalId` (Reddit
can derive it from a normal comments permalink). Configure only the providers you
are authorized to use:

| Provider | Required runtime variables | Supported snapshot |
| --- | --- | --- |
| Threads | `THREADS_GRAPH_VERSION`, `THREADS_ACCESS_TOKEN` | views, likes, replies, reposts/quotes/shares |
| Facebook post | `META_GRAPH_VERSION`, `META_ACCESS_TOKEN` | reactions, comments, shares when the app has access |
| Reddit | `REDDIT_ACCESS_TOKEN` and recommended `REDDIT_USER_AGENT` | score and comment count |
| Product Hunt | `PRODUCT_HUNT_ACCESS_TOKEN` | votes and comment count, subject to Product Hunt API terms |
| Indie Hackers | none | no official public adapter; verified manual snapshot only |
| LinkedIn | none | manual evidence only; no scraping or personal-session automation |
| Email opt-in | none | consent/unsubscribe tracking only; no automatic send |

The official-API collector is disabled by default because browser-verified
tracking is the primary mode on this machine. Set `SEEDING_TRAFFIC_POLL_MINUTES`
to `240` (or another value of 15 or more) only when an official adapter is
deliberately configured; set it to `0` to keep it disabled.
It uses bounded timeouts and retries transient failures;
each success/failure is auditable. Its next run is derived from the latest
persisted collector receipt, so restart preserves cadence and an overdue cycle
runs after startup instead of being postponed by another interval. It never
reads the browser session. Facebook
Groups access is limited by Meta app permissions, so the module does not claim it
can inspect arbitrary personal-group posts. Product Hunt API use for a commercial
workflow requires Product Hunt's permission. See the official
[Product Hunt API v2 documentation](https://api.producthunt.com/v2/docs).

Conversion events recorded locally require a stable event ID, source, timestamp,
currency, integer value in minor units, and a non-empty consent basis. Duplicate
`source + eventId` pairs are rejected. These are first-party organic funnel events;
the module does not upload them to an advertising network.

## Authenticated local API

Read-only `GET /health`, `GET /api/dashboard`, `GET /api/flow-graph` and static
dashboard assets do not require a token. Raw `GET /api/state` requires the
operator token because it contains full campaign and conversation records.
Mutations require an appropriate runtime token:

```powershell
$agenticRoot = if ($env:AGENTIC_ROOT) { $env:AGENTIC_ROOT } else { 'D:\build-agentic-AI' }
$runtimeRoot = if ($env:SEEDING_DATA_DIR) { $env:SEEDING_DATA_DIR } else { Join-Path $agenticRoot '.agentic\marketing-seeding' }
$operatorToken = [IO.File]::ReadAllText((Join-Path $runtimeRoot 'operator-token')).Trim()
$headers = @{ Authorization = "Bearer $operatorToken" }
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4318/api/bootstrap/r19' -Headers $headers
```

`GET /api/operator/session` is the only authenticated read endpoint; the UI uses
it to verify a token without mutating campaign state.

### Remote/VPS monitoring

The Node listener is intentionally loopback-only. Do not expose port `4318`
directly to the public Internet or copy the operator token into a VPS image,
Git repository, browser URL or chat. For remote monitoring, place a TLS
reverse proxy or a private VPN (for example, a site-to-site tunnel) in front
of the loopback service, keep the bearer token as a second local API guard,
and add separate viewer/operator identities before sharing access with a
second person. Browser profiles and social login sessions must remain on the
operator workstation; the VPS may store analytics and evidence only.

The JSON store enforces a single-writer lease at `state.json.writer.lock`: while
the dashboard server is running, make mutations only through its authenticated
HTTP API. A second server or mutating CLI process is rejected; a stale lease is
recovered only after the recorded process no longer exists. CLI `status` and
`export` remain read-only.

## 24/7 recovery and soak testing

`Start-SeedingDashboard-Supervisor.ps1` checks loopback health every 30 seconds
and restarts the hidden service when needed. Register it for the current Windows
user at logon (no password or token is embedded in the task):

```powershell
.\Install-SeedingDashboard-Autostart.ps1
Get-ScheduledTask -TaskName 'Jang Global Seeding Dashboard'
```

The automated recovery test sends concurrent reads and serialized mutations,
terminates the fixture process, restarts it on the same data directory, and
verifies that revision/state survived. For an elapsed soak, point the read-only
runner at the live service; it never mutates state:

```powershell
$env:SEEDING_SOAK_MINUTES = '4320' # three days
$env:SEEDING_SOAK_INTERVAL_MS = '5000'
pnpm.cmd soak
```

An accelerated run proves the harness works, but it is not evidence that a real
multi-day wall-clock soak or physical reboot has completed. Keep the generated
summary and Windows Task Scheduler history as production evidence.

The daily 23:30 Chrome checkpoint records `browser_verified` snapshots only for counters
rendered visibly on the exact post. Login walls, CAPTCHA, removed posts and
ambiguous layouts are `unknown`; it never substitutes zero. The `Collect API data now` action remains optional for configured official adapters.

## Local fixture worker bridge

The optional `SEEDING_FIXTURE_WORKER=1` bridge observes `queued` or
`awaiting_publish` posts and runs the local adapter from
`MARKETING_FIXTURE_ROOT`, which defaults to the repository's bundled test fixture. It records a `fixtureAutomation` receipt in the
dashboard, but intentionally leaves `post.status` and the real
`publicationUrl` unchanged. `CLOAKBROWSER_CDP_URL` is read from `.env`; CDP
attachment requires the explicit `SEEDING_FIXTURE_CDP_ENABLED=1` flag and the
adapter still uses `mock_click_publish` without a live Publish click.

`SEEDING_FIXTURE_E2E_LIVE=1` enables read-only navigation and DOM probes for
QA. It records `e2e_verified_readonly`, `e2e_dom_timeout`, or
`e2e_network_error`; it never clicks a production Publish control.

## Post lifecycle

`draft -> needs_review -> approved -> queued -> publishing -> processing -> published`

Failures return to review; paused/rejected states remain explicit. Queue guards
enforce approval, target-rule review, per-account daily caps, minimum spacing and
seven-day duplicate-content detection. A `published` transition also requires a
direct HTTP(S) post URL distinct from the target landing page and non-empty
verification evidence.

## Operating workflow

1. Import a verified product artifact and campaign brief.
2. Add only relevant communities; record each community's promotion rules.
3. Create channel-specific variants instead of pasting the same copy everywhere.
4. Approve posts individually, then let Orca/browser execution publish one target.
5. Verify the actual permalink or playable post before marking `published`.
6. Capture metrics snapshots at agreed intervals (for example 1h, 24h, 72h).
7. Capture comments, let AI draft contextual replies with explicit source files
   from the product repository, and approve before sending. Grounding paths are
   canonicalized, restricted to the campaign repository, read, and stored with
   SHA-256 plus byte length.
8. Use dashboard evidence to decide which audience/problem should shape the course.

The local API also supports registering/updating targets, editing unapproved
posts, adding metric snapshots/interactions, drafting grounded replies, and
recording publication/reply evidence. See `src/server.mjs` for the endpoint map.

The system never promises that posting limits avoid every platform restriction;
the guards reduce burst and duplicate behavior while respecting community rules.
