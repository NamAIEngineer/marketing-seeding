# GPM runtime discovery — LinkedIn authority preparation

Date: 2026-10-25 UTC
Branch: `wave/distribution-os-runtime-wave-13-bridge`
Candidate: `56508c677247568636ade6d89e96dec0c4b2b93f`

## Result

`HUMAN_INTERVENTION_REQUIRED_LOGIN`

The installed GPM runtime is reachable and its supported local HTTP API was
used read-only for catalog inspection, then explicitly invoked to start and
stop each existing profile. Both profiles returned a supported Chrome remote
debugging port and were inspected through CDP. Both LinkedIn navigations ended
at LinkedIn's unauthenticated `authwall`. No profile can be selected as the
authorized `linkedin_primary` account from live identity evidence.

## Runtime

- Application: `/Applications/GPMLoginGlobal.app`
- Executable: `/Applications/GPMLoginGlobal.app/Contents/MacOS/GPMLoginGlobal`
- Bundle version: `1.0`; UI/runtime sender: `GPMLoginGlobal v5.1.2-stable`
- GPM process: running during audit
- Supported HTTP API: `http://127.0.0.1:9495`
- Supported WebSocket control listener: `127.0.0.1:9496` (not used for this audit)
- Read-only catalog route: `GET /api/v1/profiles`
- Profile start/stop route: `GET /api/v1/profiles/{start|stop}/{profileId}`
- Existing non-deleted profiles: 2
- Browser engine: Chromium/Chrome `152.0.7977.140`

No undocumented endpoint, credential extraction, cookie export, profile copy,
profile clone, or secret persistence was used.

## Profile attempts

| profile reference | label | start/attach | LinkedIn result | selected |
|---|---|---|---|---|
| `5464abad-2fbc-4fd1-8038-0fd5dec56eee` | `PPN-resume-eedfc9f2-ae28-40ce-ac70-3d6b380368f2-vajearaanara-20261021-163802` | PASS; CDP port observed | `authwall` / login required | NO |
| `3f199ed6-162b-4588-9932-f2c518983024` | `PPN-T1-20261021-163002` | PASS; CDP port observed | `authwall` / login required | NO |

Each started profile was stopped through the same supported API. No browser
child remained after cleanup. No login, password, MFA, challenge bypass, or
social action occurred.

## Authority and certification gates

- GPM provider reachable: YES
- Host/provider process attestation: PARTIAL runtime-only; usable authority attestation: FAIL
- Authorized GPM profile supplied: NO
- Live LinkedIn authenticated identity: NO
- Expected identity `Nam Phạm Phương`: NOT OBSERVED
- Expected URL `https://www.linkedin.com/in/nam-ph%E1%BA%A1m-ph%C6%B0%C6%A0ng-b48897278/`: NOT AUTHENTICATED
- Reversible GPM LinkedIn calibration: 0 trials
- GPM transport certification: NOT_CERTIFIED
- Fresh governance preflight: NOT_RUN
- Final Post clicks: 0
- Social publications: 0
- Historical UNKNOWN executions retried/mutated: 0

## Package state

`plans/autonomous-build/distribution-os-runtime-wave-13/external-input.json`
was not created. Creating it would require inventing missing authority. The
placeholder package remains `allowLiveExecution: false`.

Missing irreducible input:

1. Fresh authorized LinkedIn account/profile/session permission, identifying the
   exact GPM profile reference.
2. Human login in that profile, if required. Credentials must not be supplied
   to or persisted by the system.
3. Exact target permission and target URL/ID.
4. Approved harmless UTF-8 payload/media policy.
5. UTC validity bounds, standing authorization reference, quota, cadence, and
   concurrency policy.
6. Fresh host/provider attestation reference after authenticated identity is
   observed.

## Verification

- `npm test`: **698 total, 696 pass, 0 fail, 2 skip**
- Working tree: clean
- Canonical state SHA-256 unchanged:
  `2ed58f8972072c9f5a0921830c0af6a1502b443017c0db2c2f82856f388eb1d7`
- Canonical revision unchanged: `54861`
- Effective authorization/windows/grants/leases: `0/0/0/0`
- Historical UNKNOWN count: `6` before and after
- Final Post clicks: `0`

## Next action

Human completes a normal LinkedIn login in one existing GPM profile and supplies
only the fresh secret-free authority facts required by
`external-input-schema.md`. Then rerun the bounded identity/attestation and
reversible calibration lane. Do not publish in this task.
