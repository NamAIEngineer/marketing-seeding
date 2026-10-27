# Decisions

- Candidate `6600387` is the C integration checkpoint. Evidence artifacts must cite this exact revision.
- Isolated server smoke on port `4324` used source revision `df2f775ee23dd4475e9b358bc42f5e1770b73e29`, private state, and loopback Qwen configuration. Later documentation commits must not be presented as that runtime revision.
- Treat the local review queue result as `FAILED`, not PASS: no-progress guard prevented independent verifier completion. Keep manual review at `DONE_WITH_CONCERNS`.
- Keep the active runtime at `4318` untouched because Orca ties it to A's worktree. C smoke uses isolated ports/data only.

- Keep marketing-seeding as sole app/store/orchestrator.
- oi-browser source is pinned externally and only useful primitives are adapted.
- Camoufox/API/direct transports remain executor lanes; no GPM.
- Safe fixture evidence never upgrades to live verification.
