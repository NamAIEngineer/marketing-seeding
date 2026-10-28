# Blockers

| ID | Status | Evidence | Impact | Minimum resolution |
|---|---|---|---|---|
| A-DIRTY-OVERLAY | OPEN / PRESERVED | A ACK `SESSION-A-ACK-20261028T1210Z`; HEAD `1ed5771`; 3 tracked dirty files + 475 untracked; runtime `4318` remains A-owned | A's latest overlay is not in candidate | A owner creates a clean reviewed checkpoint; C reconciles serially |
| B-CHECKPOINT-PROVENANCE | ADAPTED / CLOSED FOR CURRENT CANDIDATE | B ACK `SESSION-B-ACK-20261028T1210Z`; `b675a98` tracked clean; behavior confirmed by candidate tests/history; commit is not ancestor | Exact B commit remains separate; obsolete diff must not be imported | Re-review only if B supplies behavior absent from candidate |
| CAMOUFOX-LIVE-AUTH | OPEN | No fresh authenticated Camoufox identity/readiness evidence | No live publish proof | Authorized fresh account/profile lane with canonical readiness and independent publication verification |
| LIVE-PUBLICATION-METRICS | OPEN | No live post ID/permalink/metrics/conversion | Closed loop live acceptance incomplete | Valid standing authority plus certified transport and independent verification |
| AUTO-GTM-GENERATION | OPEN | Runtime/dashboard reports `feed_not_generated`; source capability is lead/feed only | Generation/media acceptance incomplete | Configured owner-approved Auto-GTM generation/media capability artifact |
| PROVIDER-A-RUNTIME | CONDITIONAL | A runtime `/health` reports `sourceCommit=unknown`; candidate port `4337` explicit Qwen smoke succeeded locally and is isolated | A runtime provider state is not proven by candidate smoke | Owner runtime must expose exact build/config and fresh health/inference evidence |
| A-B-NATIVE-HANDSHAKE | ACKNOWLEDGED | Orca native `turn_started` plus A/B ACK markers at `1210Z` | Communication proven; checkpoint/reconciliation still serial | A clean checkpoint and C review |
| INDEPENDENT-REVIEW | STALE | Prior verifier PASS covered `20ba20f`/`e9a7bfa`, not current `7378f8c` | Current final docs/evidence need a fresh independent read-only review | Re-run verifier on final committed candidate |

No blocker is cleared by fixture success, process liveness, dashboard rendering, or historical evidence.
