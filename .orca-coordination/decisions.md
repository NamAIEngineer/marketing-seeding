# Integration decisions

- Candidate: `integration/session-c-reconciled`; current source/test checkpoint `35cc224febb5eb9c8368cf88f5f28b6a119b6be3`, docs/evidence follows on branch (prior integration checkpoint `7f2b74a`); native coordinator checkpoint `7378f8c`.
- A checkpoint `1ed5771` is represented in candidate history. A's current 3-file tracked overlay and untracked files remain untouched.
- B checkpoint `b675a98` is not an ancestor of the candidate and is not cherry-picked blindly. Its substantive authority behavior (standing reference scope collision protection, second-campaign rejection, delegation validation before browser input/ready exposure/worker start) is present through candidate history from `0232a3e` and is covered by current tests. B's obsolete provider/GPM-era differences remain excluded.
- `marketing-seeding` remains the only application, `JsonStore`, `SeedingService`, dashboard, and Decision Plane. No second oi-browser app/store/orchestrator was added.
- oi-browser source pin: `1e471c44b5d63aa5aadb708623b21090b6f325b2`; auto-gtm source pin: `9368098477d78f75d57fdf5db276129948f3a183`.
- oi-browser memory, provider routing, static BrowserSnapshot/semantic identity, and validated intent seam are adapted into the canonical store/service. Static evidence cannot prove live DOM or publication.
- Auto-GTM remains a read-only `lead-feed` capability. `feed_not_generated` is surfaced as unavailable; no generation/media claim is made.
- GPM is not active in the server runtime. Historical compatibility modules remain only where existing contracts require them.
- Active runtime `4318` belongs to A and was not restarted. Candidate verification used private temporary state and port `4337`.
- Candidate runtime smoke with explicit loopback Qwen configuration returned `SUCCEEDED` and retained one successful route after restart. This is `RUNTIME_VERIFIED` local inference evidence; it does not upgrade A's runtime configuration or prove external provider/live publication.
- Fixture/runtime evidence remains separate from live evidence. No credential, login, grant, publish, deployment, merge, or external side effect was performed. C source/test checkpoint is `35cc224`, current docs/evidence is recorded by the follow-up commit; existing draft PR #2 remains open; no merge performed.
- Native handshake `SESSION-C-HANDSHAKE-20261028T1210Z` returned A/B ACK markers with `turn_started` and exact native terminals. This proves communication, not final A dirty checkpoint reconciliation.
- Decision `MEMORY-SAMPLE-IDENTITY-20261028`: canonical evidence references are the independent sample boundary. Caller-controlled `publicationId`/`sampleId` aliases cannot increase support after evidence is bound; distinct canonical evidence refs are retained. This preserves polling dedupe and retraction semantics.
- Decision `PROVIDER-DEADLINE-20261028`: provider deadline wraps fetch plus response body/JSON consumption using one abortable race. Timeout returns UNKNOWN/failure; no health/success promotion occurs. Caller abort is propagated and already-aborted signals fail fast.
