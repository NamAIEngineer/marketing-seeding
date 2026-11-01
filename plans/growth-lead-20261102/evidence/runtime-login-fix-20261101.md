# Runtime login fix evidence

- Timestamp: 2026-11-01 ICT
- Workspace: `ms-growth-runtime-20261101`
- Branch: `NamAIEngineer/ms-growth-runtime-20261101`
- Scope: Camoufox identity discovery and bounded login controls.

## FACT

- LinkedIn identity observation now visits `/in/me/` and accepts only a canonical `/in/<id>` redirect; `/login`, challenge, host mismatch, and unchanged `/in/me` remain fail-closed.
- Facebook identity observation now visits `/me` and accepts only a canonical profile URL or numeric `profile.php?id=` redirect; reserved surfaces and login/challenge remain fail-closed.
- Adapter login returns `LOGIN_CONSENT_OVERLAY` when a consent surface is detected while bounded credential controls are unavailable. No blind cookie/session import.
- Focused tests: 43 passed, 0 failed.
- `node --check` passed for changed modules; `git diff --check` passed.

## UNKNOWN / LIMITATIONS

- No authenticated live account or credential material was used. Redirect proof is covered by bounded protocol logic and existing fixture tests; live identity/permalink remains UNKNOWN until Nam completes manual login.
- No build, deployment, restart, or publication performed in this lane.
