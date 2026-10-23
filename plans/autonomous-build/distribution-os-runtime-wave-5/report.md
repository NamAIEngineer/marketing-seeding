# Distribution OS Runtime Wave 5 — controller release report

Observed: 2026-10-23 Asia/Ho_Chi_Minh
Branch: `wave/distribution-os-runtime-rc`
Release candidate commit: `94253afc5a929ff7668cec4f7713166568003651`

## Unverified items first

- UI typecheck/build is not verified in this RC because `vite` is unavailable in the local UI dependency environment.
- GPM profile start/stop, profile attach, CDP/WebSocket control, login/session health and account identity remain unverified. No profile was started or attached.
- Camoufox remains `UNKNOWN`; no isolated browser observer was launched.
- This RC is not merged into `main` and is not deployed to the canonical service.

## Outcome

Wave 5 adds a read-only GPM profile catalog observation to the existing dynamic listener probe. The implementation calls only the observed same-origin GET endpoint `/api/v1/profiles`, allowlists bounded profile metadata, drops proxy/storage/note/session-like fields, and leaves GPM health `UNKNOWN` until an explicit profile/account/session binding and readiness proof exist.

## Changes

- `src/gpm-runtime-probe.mjs`: same-origin GET-only catalog request, schema fail-closed handling and bounded allowlist.
- `src/runtime-projection.mjs`: bounded Mission Control catalog projection.
- `src/server.mjs`: wires `/api/v1/profiles` into the read-only probe.
- focused tests: GET-only behavior, schema drift, secret-like field dropping and unbound readiness.

## Fresh evidence

- Focused runtime/GPM/router/projection/account gates: **25 total / 25 pass / 0 fail / 0 skip** in controller run.
- Independent focused safety batch: **58 total / 58 pass / 0 fail / 0 skip**.
- Full `npm test`: **618 total / 616 pass / 0 fail / 2 skip / 0 todo**, exit 0.
- `node --check` for changed modules: PASS.
- `git diff --check`: PASS.
- Independent leakage review found no emitted `raw_proxy`, `storage_path`, `note`, credential, cookie, password, token or session fields in production projection.
- Read-only live GPM probe discovered listeners on ports 9495 and 9496, observed provider `5.1.2-stable`, and observed 2 allowlisted catalog rows. It did not start/stop or attach a profile.
- GPM transport health remained `UNKNOWN` with `GPM_PROFILE_REFERENCE_NOT_BOUND`.
- ORCA read-only status remained version `1.4.237`, state `ready`, reachable and connected.
- Canonical state remained schema 8, revision `54861`, SHA-256 `2ed58f8972072c9f5a0921830c0af6a1502b443017c0db2c2f82856f388eb1d7`, 6 immutable UNKNOWN submissions and 0 published posts.

## Acceptance

| ID | Result |
|---|---|
| A1 | PASS: read-only GPM catalog probe |
| A2 | PASS: bounded allowlist and secret-like field drop |
| A3 | PASS: catalog does not create account identity or readiness |
| A4 | PASS: existing router and irreversible-submit fences unchanged |
| A5 | PASS with UI/runtime concerns: tests and independent review complete |
| C1-C4 | PASS: no mutation, no secret persistence, UNKNOWN history preserved, unbound health fail-closed |
| V1 | PASS: fake fetch tests |
| V2 | PASS: fresh full/focused/syntax/diff gates |
| V3 | PASS: independent verifier after final change |

## Limitations and next action

This is an observability increment. It does not start GPM profiles, identify a LinkedIn account, refresh readiness, select an account, execute a browser action, verify a publication, or provide a live metrics loop. The next safe software slice is a fail-closed account/profile reconciliation projection; it must not infer identity from names or promote catalog rows into execution accounts.

Status: DONE_WITH_CONCERNS
