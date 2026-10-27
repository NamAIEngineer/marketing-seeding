# Product Factory Browser Capture

## Acceptance IDs addressed

A3, A5, A6 (V1 partial; worker completion channel was unavailable).

## Summary

Added a deterministic browser capture plan and explicit backend execution seam.
The seam records source commit, run identity, plan/artifact hashes, capture
timestamp and runtime identity. It returns typed unavailable/failed states when
runtime or backend evidence is absent and never fabricates media.

## Evidence

- `src/product-factory-capture.mjs`
- `test/product-factory-capture.test.mjs`
- `node --test test/product-factory-capture.test.mjs test/product-factory.test.mjs` (25 pass)
- `node --check src/product-factory-capture.mjs`
- `git diff --check`

## Confidence

Confident for deterministic plans, fail-closed execution, artifact hashing and
immutable provenance under an injected bounded fixture backend. Arbitrary repo
build/run, real browser capture, GIF/video generation and service integration
remain unverified.

## Out-of-scope noticed

No browser launch, external network action, social action, deployment or
runtime-state mutation was performed.

Status: DONE_WITH_CONCERNS
Summary: Product Factory capture seam is locally verified and deliberately does not claim a real media backend.
Concerns/Blockers: No installed Camoufox capture backend was exercised.
