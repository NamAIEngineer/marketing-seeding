# Wave 13 GPM Adapter Surface Builder

- FACT: `GpmExecutionTransport` previously exposed only provider-neutral primitives and rejected protocol clients lacking a fixed minimal set.
- FACT: current LinkedIn execution requires browser-compatible methods including tabs, navigation waits, evaluation, snapshot, fill, uploads, and command count.
- INFERENCE: explicit `asBrowserSurface()` delegation is safer than endpoint guessing or LinkedIn-specific logic.
- UNKNOWN: live GPM/CDP protocol support and authenticated execution remain unverified.

## Changes

- Added strict `asBrowserSurface()` / `browserSurface` facade.
- Added delegation for `listTabs`, `showTab`, `navigate`, `waitForUrl`, `waitForExpression`, `evaluate`, `snapshot`, `fill`, `upload`, `uploadSelector`, `browserCommandCount`.
- Missing protocol methods fail with `GPM_PROTOCOL_CAPABILITY_UNSUPPORTED`.
- Added runtime identity, transport contract validation, and pre-click validation marker.
- Preserved validated click boundary and idempotent detach.
- No profile start, live attach, browser action, social mutation, or secret exposure.

## Verification

- Focused transport tests: 6 pass, 0 fail, 0 skip.
- `node --check src/gpm-execution-transport.mjs`: pass.
- `git diff --check`: pass.

Status: DONE_WITH_CONCERNS
Summary: GPM transport now exposes a strict provider-neutral browser surface through injected protocol capabilities, with fail-closed missing methods and preserved click/detach safety.
Concerns/Blockers: Live GPM protocol compatibility, certification, and publication remain unverified.
