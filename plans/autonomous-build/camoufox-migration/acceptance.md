# Camoufox migration audit acceptance

## Requirements

- A1. Inspect the current marketing-seeding worktree, branch, HEAD, architecture, tests, runtime configuration, and canonical-state boundary.
- A2. Inspect existing Camoufox-related code, worktrees, dependencies, profiles, and live process/runtime evidence without starting a browser or mutating account state.
- A3. Inspect the real Auto-GTM repository and existing `src/auto-gtm-feed.mjs` bridge; document producer, schema, consumers, freshness, dashboard/strategy behavior, and gaps.
- A4. Classify GPM-related components as KEEP_PROVIDER_NEUTRAL, MIGRATE_TO_CAMOUFOX, LEGACY_REFERENCE, or DELETE_AFTER_MIGRATION, preserving historical evidence.
- A5. Map current capabilities, manual operations, platform status, autonomy maturity, production proof, duplicated components, and critical blockers.
- A6. Recommend the smallest safe next implementation slice toward Camoufox authenticated LinkedIn proof, without creating live authority or publication controls.

## Constraints

- C1. Read-only runtime audit: no canonical-state mutation, no authorization/window/grant/lease/execution creation, no durable submit intent, no social publication, no Post click, no historical UNKNOWN retry or reconciliation.
- C2. Do not use GPM as the target active runtime; preserve its evidence and provider-neutral code only.
- C3. Do not export or persist cookies, passwords, tokens, localStorage, or raw session material.
- C4. Do not create duplicate browser, execution, bridge, or market-intelligence abstractions when existing code can be reused.
- C5. Treat repository reports and prior claims as historical evidence; verify live state from files, Git, process/runtime inspection, and tests where necessary.
- C6. Report FACT, INFERENCE, ASSUMPTION, and UNKNOWN separately. No production claim from fixture or source-only evidence.

## Verification

- V1. A fresh audit report exists under `plans/autonomous-build/camoufox-migration/reports/`, ends with the required status line, and includes evidence paths.
- V2. Target Git HEAD/worktree and canonical state remain unchanged except for declared audit artifacts.
- V3. Audit identifies exact active target workspace(s), branches, services/processes, Camoufox capability, GPM dependencies, Auto-GTM bridge facts, and external blockers.
- V4. Independent host inspection confirms no live social mutation or execution control was created during the audit.
