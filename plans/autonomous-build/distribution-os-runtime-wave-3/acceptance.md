# Distribution OS Runtime Wave 3 — acceptance

## Objective
Advance the provider-neutral distribution runtime on the clean RC without live social mutation, merge, deploy, or ORCA restart. Resolve only bounded runtime-observability gaps that are supported by read-only evidence.

## Requirements
- A1: Independently inspect the installed GPM runtime and report whether a safe read-only API/profile capability is discoverable without secrets or profile mutation.
- A2: Independently inspect installed Camoufox/profile/runtime capability and report whether an isolated public-observation backend can be connected safely.
- A3: Make ORCA Mission Control health truthful: it must use bounded read-only executable/connected-version evidence or report UNKNOWN, never unconditional READY.
- A4: Re-run focused runtime, transport, authority, and safety gates on the RC after the last change; no external/social mutation.
- A5: Record current limitations and update the wave report with exact RC commit/test evidence.

## Constraints
- C1: Do not modify main, integration, canonical state, or worker branches.
- C2: Do not restart ORCA, start/stop browser profiles, login, click Post, publish, retry UNKNOWN, or mutate any social account.
- C3: Never expose cookies, passwords, access tokens, session secrets, or raw profile credentials.
- C4: Preserve COMMAND_COMPLETED / CONTROL_ACTIVATED / PLATFORM_ACCEPTED / PUBLICATION_VERIFIED separation.
- C5: No merge or deploy in this wave; release approval remains human-gated.

## Verification
- V1: Fresh `npm test`, focused runtime tests, syntax check, and `git diff --check` pass or exact failures are reported.
- V2: ORCA health projection tests prove READY only after successful bounded version/status probes and UNKNOWN/UNAVAILABLE otherwise.
- V3: Existing canonical UNKNOWN IDs/state and ORCA process remain unchanged.
- V4: Independent worker reports cite direct observations and classify FACT/INFERENCE/UNKNOWN.

## Stop condition
Stop after A1–A5 are either evidenced or explicitly blocked by a narrow external/runtime fact; do not expand into live platform execution.
