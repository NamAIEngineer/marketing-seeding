# Browser Runtime Router

Status: DONE_WITH_CONCERNS

## Acceptance IDs addressed

A1, A2, A5, A6 (router and bounded transport seams; V1 partial).

## Summary

Added a provider-neutral workload router with explicit GPM, Camoufox, and ORCA registration. GPM and Camoufox transports expose bounded non-secret identity references, fail-closed health probes, and typed unsupported capabilities. Route selection is deterministic and guarded against switching after durable intent.

## Evidence

- `src/browser-runtime-router.mjs`
- `src/browser-runtime-transports.mjs`
- `test/browser-runtime-router.test.mjs`
- `node --test test/browser-runtime-router.test.mjs test/browser-interaction-transport.test.mjs`
- `node --check src/browser-runtime-router.mjs src/browser-runtime-transports.mjs`
- `git diff --check`

## Confidence

High for policy routing, redaction, fail-closed probes, and no post-intent switch. Provider-specific GPM/Camoufox APIs remain intentionally unimplemented until runtime contracts are verified.

## Out-of-scope noticed

No live browser attachment, profile startup, certification, social submit, or deployment was performed.
