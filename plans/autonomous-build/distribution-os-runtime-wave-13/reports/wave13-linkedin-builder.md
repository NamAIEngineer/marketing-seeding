# Wave 13 LinkedIn Adapter Builder Report

## Evidence ledger

- FACT: `LinkedInAdapter` previously defaulted to `new OrcaAccessibilityTransport(browser)` and selected certified transports internally at submit time.
- FACT: execution uses ORCA-shaped browser methods (`listTabs`, `showTab`, `navigate`, `waitForUrl`, `evaluate`, `snapshot`, `fill`, and waits); `GpmChromeTransport` alone does not implement that surface.
- FACT: adapter already persists selected transport identity through `beforeSubmitIntent` and rejects post-intent identity changes via `assertTransportCannotChangeAfterIntent`.
- INFERENCE: per-execution session injection is the narrowest safe bridge until a generic browser facade exists.
- ASSUMPTION: worker/session builder will provide a browser-compatible `browserSurface` and validated transport together.
- UNKNOWN: live GPM attach protocol, browser surface implementation, certification, and publication remain unverified.

## Changes

- `src/linkedin-adapter.mjs`: added constructor injection for `{ session, browserSurface }`; injected transport is authoritative and cannot be replaced by ORCA/certification candidate selection.
- `src/linkedin-adapter.mjs`: added per-execution `execute(request, { executionSession, transport, browserSurface })` injection. Missing/incomplete generic surface fails closed before browser input.
- `src/linkedin-adapter.mjs`: selected transport identity propagates through existing submit-intent fence; no post-intent fallback.
- `test/linkedin-verification.test.mjs`: tests constructor authority and per-execution incomplete-surface fail-closed behavior; no final click.

## Verification

- `node --test test/linkedin-verification.test.mjs`: 57 pass, 0 fail, 0 skip.
- `node --check src/linkedin-adapter.mjs`: pass.
- `git diff --check`: pass.

## Could not verify

No live GPM/CDP attach, authenticated session, browser navigation, LinkedIn action, publication, deployment, or merge performed. Full generic GPM browser facade is intentionally not implemented in this lane; worker must supply one.

Status: DONE_WITH_CONCERNS
Summary: LinkedInAdapter now accepts authoritative per-execution or constructor-injected transport/session and fails closed when the required browser surface is absent. Existing durable transport fence remains active; end-to-end GPM execution awaits the worker-provided compatibility facade.
Concerns/Blockers: GPM transport still lacks the adapter browser surface; no live or irreversible proof.
