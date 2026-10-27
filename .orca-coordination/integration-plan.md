# Session C Integration Plan

- Candidate checkpoint: `integration/session-c-candidate` at `6600387b254db13bf0494fc14a8f512a6f990e1a`.

- Controller: SESSION C (`integration/session-c-oi-browser`), base `79985bb411afc141f0edf10ae635fb91824d8bc9`.
- SESSION A: `wave/distribution-os-runtime-wave-13-bridge`, `/Users/nam/Documents/marketing-seeding-wave-13-bridge`, HEAD `52072ce`, dirty Camoufox/runtime files; no live Orca terminal.
- SESSION B: `integration/autonomous-build`, `/Users/nam/Documents/marketing-seeding-integration`, HEAD `6899679`, dirty authority/service files; no live Orca terminal.
- C scope: docs/integrations, new native integration modules/tests, adapters that do not overlap A/B dirty files.
- Approval gates: no publication, merge, deploy, credential change, or external write.
- Native coordination state: A/B worktree metadata is visible through Orca, but no A/B terminal/agent receiver is attached and the inbox is empty. Coordination therefore remains evidence-only until a native receiver is actually available.
- Candidate evidence: fixture `FIXTURE_VERIFIED`; isolated server smoke `RUNTIME_VERIFIED`; live publication `UNKNOWN/unverified`.
