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
| CHATGPT-THREAD-HANDSHAKE | FIXTURE/RUNTIME VERIFIED | Live accessibility tree in Chrome contained marker `ORCA_MS_OS_ABC_CHATGPT_20261028_MASTER_01` and URL `/c/6ae09d26-12c4-83ec-bd1f-d53553e707cc`; bridge `xchg-50bacbd9c3064aa2a7e0` returned correlated nonce/marker and completed `chatgpt-web` receipt | Bridge transport lacks native `message_id`; exact response correlation uses nonce + URL + fresh completed AX turn | Keep bridge receipt bounded; do not treat advice as authority or live proof |
| SUPERVISOR-WAKE-REPLAY | FIXTURE VERIFIED / NATIVE RESUME PARTIAL | `plans/oi-browser-integration/coordination-rehearsal-20261028.json`; coordinator task woke, completed, artifact hash accepted, restart retained one result and did not replay | Orca B terminal follow-up remains unconfirmed; existing v60–v63 provider/team recovery failures remain historical blockers | Owner must restore/confirm B receiver or accept coordinator-only scope |
| INDEPENDENT-REVIEW | CLOSED | Fresh read-only verifier PASS at `2026-10-28T05:44:28Z`, HEAD `d4e8ee0`; worktree clean; metadata/source recheck passed | No review blocker | None; retain substantive live blockers separately |

No blocker is cleared by fixture success, process liveness, dashboard rendering, or historical evidence.
