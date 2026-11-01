# Quality-A packaged runtime verification — 2026-11-02 04:24 ICT

Status: `PASS_WITH_LIMITATIONS`

## FACT

- Lead source HEAD: `26f2884a2e96703990e4321333b7cd6e7743bf23` (requested final HEAD). `git status --short` produced no entries: clean.
- Packaged runtime `127.0.0.1:4321` is listening, PID `17330`; `/health` returned HTTP 200.
- Runtime health: `sourceCommit=9ca603cd25c2a34a8d3a2856957102b119c8119e`, `sourceDirty=false`, `schemaVersion=8`, `stateRevision=452`.
- Legacy port `127.0.0.1:4318` remains listening, PID `35020`.
- `/api/dashboard` growth projection: videos `ready=10`, `qaFail=0`, `bufferTomorrow=10`; all artifacts quality `A`, QA `PASS_QUALITY_A_WINDOW_CAPTURE`, paths under `video/quality-a/artifacts`.
- Growth pilot is `armed`, one experiment with `slotCount=10`, 10 scheduled slots (`07:00` through `23:00` Asia/Ho_Chi_Minh), readiness gate `account_ready`, no burst policy.
- Community projection reports `discovered=30`; all public candidate rows remain unauthenticated/UNKNOWN and ineligible pending authenticated evidence.
- Dashboard top-level `posts=0`, `schedules=0`; no publication or permalink evidence.
- Accounts remain blocked and unchanged in the runtime dashboard: Facebook and LinkedIn rows show provider/source `chrome`, `health=human_required`, `agentStatus=BLOCKED`, `loginStatus=BLOCKED`, and human-required challenge/control blockers. This is consistent with the requested bounded verification but remains a policy/integration concern because the current mission requires Camoufox manual login and forbids Chrome session reuse.
- Two MP4 routes and two thumbnail routes returned HTTP 200 with expected content types: `video/mp4` and `image/jpeg` (dos-1102-01 and dos-1102-10).
- Manifest integrity: 10 manifest artifacts, 10 quality-A receipt artifacts, 16 drafts; all manifest files exist and SHA-256 match disk; manifest and quality-A receipt hashes match one-to-one; manifest QA set is `PASS_QUALITY_A_WINDOW_CAPTURE`, quality set is `A`.
- `node --check src/growth-lead-projection.mjs` passed.
- `node --test test/growth-pilot.test.mjs`: 4 tests passed, 0 failed.

## UNKNOWN / LIMITATIONS

- Audio license evidence remains `UNKNOWN`; supplied reference credit is retained.
- This is local packaged-runtime evidence only. It proves no live social publication, group join, or permalink.
- Dashboard `posts=0` and `schedules=0` mean no publication has occurred; pilot is armed behind account readiness.
- Account rows still identify Chrome provider/source despite the required Camoufox-only manual-login policy. No Chrome cookies or sessions were copied by this verifier; remediation requires separate integration work.
- Community count 30 is public discovery evidence only; authenticated membership/rules/postability remain UNKNOWN.
- Route checks covered two artifact pairs, not all ten.

## VERDICT

`PASS_WITH_LIMITATIONS`: packaged runtime, quality-A projection, pilot arming, media routes, manifest hashes, syntax, tests, and clean Git state meet the bounded checks. Publication, account readiness/Camoufox migration, community membership, and audio-license status remain unverified or blocked.
