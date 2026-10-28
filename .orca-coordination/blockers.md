# Blockers

| ID | Status | Evidence | Impact | Minimum resolution |
|---|---|---|---|---|
| A-B-NATIVE-HANDSHAKE | OPEN / UNVERIFIED | Orca worktree metadata exists; A/B `terminal list` empty; inbox contains one undelivered historical marker; prior sends returned `terminal_not_found` | Cannot claim three-session connected task delivery or ACK | Existing A/B sessions need a runtime-supported receiver/terminal handle and must return marker ACK/result refs |
| B-DIRTY-CHECKPOINT | OPEN | B worktree HEAD `6899679`, authority/service files dirty | Cannot claim B work is reconciled or committed into candidate | B owner checkpoint/ACK, then serial diff reconcile and rerun affected tests |
| CAMOUFOX-LIVE-AUTH | OPEN | Disposable Camoufox smoke only; no fresh exact authenticated identity/readiness evidence | No live publish proof | Authorized fresh account/profile lane with canonical readiness and independent publication verification |
| LIVE-PUBLICATION-METRICS | OPEN | No live post ID/permalink/metrics/conversion | Closed loop live acceptance incomplete | Valid standing authority plus certified transport and independent verification |
| AUTO-GTM-GENERATION | OPEN | Runtime/dashboard reports `feed_not_generated`; source report says lead/feed capability only | Generation/media acceptance incomplete | Configured owner-approved Auto-GTM feed/provider artifact; retain read-only boundary |
| PROVIDER-PRODUCTION-CONFIG | CONDITIONAL | Local Qwen succeeds only when explicit loopback adapter env is supplied; absent config fails closed | Production inference availability depends on runtime config | Explicit local adapter config and health evidence in the owner runtime |
| INDEPENDENT-REVIEW | OPEN | Latest task `2fdee808-270a-491c-a042-14dc3fad3972` failed with `Remote end closed connection without response`; prior queue attempt hit no-progress guard | No independent verifier PASS | Separate read-only reviewer after final candidate changes |

No blocker is cleared by fixture success, process liveness, dashboard rendering, or historical evidence.
