# Distribution OS Runtime Wave 5 — GPM profile catalog

## Requirements
- A1: Add a read-only GPM profile catalog probe against the observed GET API contract without start/stop/profile mutation.
- A2: Allowlist only bounded non-secret profile metadata; discard raw proxy, storage path, note and credential/session fields.
- A3: Keep account identity, session health and execution eligibility UNKNOWN until explicit account binding and readiness exist.
- A4: Wire the catalog into the existing GPM liveness probe without changing route policy or irreversible-submit fences.
- A5: Add focused tests and independently rerun full/focused safety gates after the final change.

## Constraints
- C1: No profile start/stop, CDP/WebSocket attach, login, browser navigation, social mutation, ORCA restart, merge or deploy.
- C2: Do not read or persist raw proxies, storage paths, cookies, passwords, tokens, notes or session secrets.
- C3: Preserve UNKNOWN executions and canonical state; do not use profile catalog as account identity.
- C4: Keep GPM health UNKNOWN without bound profile/account/session.

## Verification
- V1: Fake fetch tests prove GET-only route, allowlisting and fail-closed schema handling.
- V2: Fresh npm test, focused GPM/runtime/authority gates, syntax and diff checks pass.
- V3: Independent verifier confirms no mutation and no secret fields in outputs.
