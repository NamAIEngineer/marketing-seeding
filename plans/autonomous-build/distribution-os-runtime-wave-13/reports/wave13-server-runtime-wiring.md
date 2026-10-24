# Wave 13 server runtime wiring

- Outcome: `src/server.mjs` now loads an execution-session resolver only through an explicit host module plus provider/profile/session-authority/host-attestation configuration, then injects it into `JevExecutionWorker`.
- Safety: absent or incomplete configuration returns `null`; invalid module/factory/provider/attestation fails closed. GPM is never inferred from discovery, ORCA is never used as an injected GPM resolver, and no profile/login/post action runs during construction.
- Commit: `905c0d1f04885afdefa02e8ef05c9010a45ca6805` (`feat(server): wire explicit execution session resolver`).
- Verification: `node --check src/server.mjs`; `git diff --check`; `node --test test/execution-session-transport.test.mjs` (6 passed).
- Limitation: no live resolver module/protocol or host attestation exists in this repository; server remains resolver-less by default. Existing dirty files were preserved.
