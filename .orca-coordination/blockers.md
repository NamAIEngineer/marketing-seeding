# Blockers

| ID | Status | Evidence | Impact | Minimum resolution |
|---|---|---|---|---|
| A-B-NATIVE-HANDSHAKE | ACKNOWLEDGED / CHECKPOINT RECONCILIATION IN PROGRESS | Native Orca follow-ups delivered to A/B handles with `turn_started`; exact review markers `RESULT-A-20261028T0420Z` and `RESULT-B-20261028T0420Z` returned with native references | Communication and review completion evidenced; candidate integration still serial | A owner checkpoint, then C diff-review and merge |
| B-DIRTY-CHECKPOINT | CHECKPOINTED / INTEGRATION PENDING | B owner commit `b675a98e6dd2da3c12133dff715eddea616c91f5`; focused authority/bootstrap tests `41/41`; tracked scope clean | B code not yet present in C candidate | C cherry-pick, conflict review, rerun affected/full tests |
| CAMOUFOX-LIVE-AUTH | OPEN | Disposable Camoufox smoke only; no fresh exact authenticated identity/readiness evidence | No live publish proof | Authorized fresh account/profile lane with canonical readiness and independent publication verification |
| LIVE-PUBLICATION-METRICS | OPEN | No live post ID/permalink/metrics/conversion | Closed loop live acceptance incomplete | Valid standing authority plus certified transport and independent verification |
| AUTO-GTM-GENERATION | OPEN | Runtime/dashboard reports `feed_not_generated`; source report says lead/feed capability only | Generation/media acceptance incomplete | Configured owner-approved Auto-GTM feed/provider artifact; retain read-only boundary |
| PROVIDER-PRODUCTION-CONFIG | CONDITIONAL | Local Qwen succeeds only when explicit loopback adapter env is supplied; absent config fails closed | Production inference availability depends on runtime config | Explicit local adapter config and health evidence in the owner runtime |
| INDEPENDENT-REVIEW | CLOSED FOR C PATCH / QUEUE FAILED | Independent verifier reviewed committed C code/evidence plus docs overlay at `2026-10-28T02:36:14Z` and returned PASS; queue task `2fdee808-270a-491c-a042-14dc3fad3972` separately failed with `Remote end closed connection without response` | C patch has independent read-only review; queue failure remains historical operational evidence | Re-run verifier after final A/B merge |

No blocker is cleared by fixture success, process liveness, dashboard rendering, or historical evidence.
