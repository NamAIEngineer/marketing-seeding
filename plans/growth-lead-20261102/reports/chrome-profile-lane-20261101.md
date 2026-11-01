# Chrome persistent profile lane

- Acceptance: A4, V2, V5
- Status: DONE_WITH_CONCERNS

## Done

- Committed `src/chrome-account-profile.mjs` production seam.
- App-owned persistent profiles only: `~/Library/Application Support/Marketing Seeding OS/chrome-profiles/<platform>-<account>`.
- Visible `launchPersistentContext`, login URLs, `/in/me/` and `/me` identity probes.
- Fail-closed canonical identity verification with `evidenceHash`.
- Added service routes:
  - `POST /api/account-credentials/chrome-login`
  - `GET /api/account-credentials/chrome-login/:sessionId`
- Routes persist provider/profile binding and identity evidence hash through `JsonStore`.
- No credentials, cookies, storage-state import, account windows, or publication used.

## Verification

- `node --check src/chrome-account-profile.mjs src/service.mjs src/server.mjs`: PASS
- `git diff --check`: PASS
- Profile/identity smoke: 6 passed

## Concerns

- Live Chrome launch not run by directive.
- Existing dirty files in worktree were not modified by this lane.
- Playwright Chromium availability remains runtime-dependent.
