# Login surface diagnosis — 2026-11-01 21:xx ICT

FACT: packaged state recorded `LOGIN_CONTROLS_NOT_FOUND` for `linkedin_nam` and `facebook_nam`.
FACT: prior runtime login path only recognized LinkedIn; Facebook credentials could not reach a bounded login URL.
FACT: Camoufox protocol identity observation now performs bounded `/in/me/` (LinkedIn) or `/me` (Facebook) redirect and fails closed on login/checkpoint/host mismatch.
FACT: login bootstrap now records a bounded, redacted snapshot hash/evidence when controls are absent; no credential or cookie/session material is included.
FACT: consent/interstitial dismissal is limited to visible labelled controls matching accept/agree/allow/continue/not now/dismiss; challenges remain HUMAN_REQUIRED.
INFERENCE: old packaged bundle produced the two account failures because it lacked these runtime changes; live retry requires packaging/restart and is not performed in this worktree.
UNKNOWN: current live Camoufox rendered DOM after the new bundle; verify after build on port 4321.
