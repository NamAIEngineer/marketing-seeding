# Camoufox Public Observer

## Acceptance IDs addressed

A2, A4, A5.

## Summary

Added an isolated public-observation seam that validates HTTP(S) destinations
through the existing bounded DNS/private-address guard, requires an explicit
isolated transport, bounds returned evidence, strips unsafe links, and never
claims publication verification.

## Evidence

- `src/camoufox-public-observer.mjs`
- `test/camoufox-public-observer.test.mjs`
- Focused observer tests pass with injected DNS/transport fixtures.
- No external site or Camoufox process was opened.

## Confidence

Confident for public URL validation, isolation requirement, bounded evidence,
UNKNOWN handling, and no-retry semantics. Real Camoufox executable/profile
startup and public crawl throughput remain unverified.

## Out-of-scope noticed

No authenticated profile, browser launch, network request, social action,
publication verification, deployment, or canonical state mutation.

Status: DONE_WITH_CONCERNS
Summary: Public observer seam is locally verified and fail-closed without Camoufox.
Concerns/Blockers: An actual isolated Camoufox runtime must be installed and attested.
