# Camoufox runtime wave 3 — isolated observer capability inspection

## Scope and safety

Read-only inspection on the RC worktree. No public page was opened, no browser/profile was started or stopped, no login or social action occurred, and no cookie/password/token/profile database contents were read or emitted. Only the assigned report file was written.

## Direct observations

### FACT

- `command -v camoufox` and `command -v camoufox-bin` returned no PATH executable. Python package metadata and the repo's Node dependency tree showed no installed Camoufox package.
- A bundled executable **does** exist in the user cache at the redacted equivalent of `~/Library/Caches/Camoufox/browsers/official/<version>/Camoufox.app/Contents/MacOS/camoufox`. It is an arm64 Mach-O executable.
- Bundled metadata reports Camoufox `156.0.1-beta.36`, build hash `0ad5663e...` (the full hash was not copied here), with app identifier `org.mozilla.camoufox`. `camoufox --version` returned `Camoufox 156.0.1-beta.36`; `--full-version` returned the same version plus build/platform IDs. No process remained afterward.
- `camoufox --help` is self-contained and documents `--headless`, `--profile <path>`, `--start-debugger-server [ws:][ <port> | <path> ]`, and `--marionette`. This establishes CLI-level headless/remote-control capability without proving a safe live connection.
- The `--help` invocation also emitted a `ContextualIdentityService.sys.mjs` `NS_ERROR_FAILURE` line while exiting with status 0. No process remained; this is recorded as a runtime warning, not readiness evidence.
- Camoufox metadata is present under `~/Library/Application Support/Camoufox/` (`installs.ini`, `profiles.ini`). The metadata declares two profiles and a default install; paths and default flags were intentionally omitted/redacted.
- The profile directory contains browser state filenames including `cookies.sqlite`, `logins.db`, `key4.db`, `cert9.db`, and places/form-history stores. Their contents were not opened. One `.parentlock` artifact is present. `lsof` found no current process holding the profile directory, but a lock artifact alone does not establish profile safety.
- The cache app is ad-hoc/linker-signed (`codesign`), with no quarantine attribute observed. This is metadata only, not a trust or runtime attestation.
- Existing RC seam: `CamoufoxTransport` is provider-neutral and fail-closed. With an executable/profile but no injected probe it reports `UNKNOWN`; with no executable/profile/client it reports `UNAVAILABLE`. It does not itself launch Camoufox or implement a debugger/Marionette client.
- Existing public observer seam requires an explicitly supplied transport with `isolated === true` and `observePublic()`. It validates public HTTP(S) URLs, rejects credentials/private destinations, bounds text/links, strips unsafe links, and always returns publication status `NOT_EVALUATED`.

### INFERENCE

- An isolated public-observation backend can be connected to the existing RC seam **only as a new, explicitly injected adapter around the discovered executable**, using a fresh dedicated public-observer profile and a bounded local debugger/Marionette client. The current RC seam is suitable for that contract because it already separates provider identity, health, and observer isolation and fails closed when the probe/client is absent.
- Existing default profiles must not be reused for public observation: metadata and state filenames show they are persistent profiles with credential/session stores, and no evidence proves they are isolated or unauthenticated. A profile reference alone cannot turn this runtime `READY`.
- The executable's documented remote-control flags are capability evidence, not proof of safe connectivity, profile isolation, network egress policy, or public-page observation. Launch/connect testing is intentionally outside this task's safety boundary.

### UNKNOWN

- Whether the bundled binary can start successfully under the current macOS runtime with a newly created disposable profile.
- Whether the `ContextualIdentityService` warning seen during `--help` indicates a profile/runtime compatibility issue outside the no-profile probe.
- Whether a compatible local debugger/Marionette client is installed and can enforce public-only URL/DNS policy, timeout, bounded evidence, and no mutation.
- Whether the profile lock is stale or indicates an owner outside the current process listing.
- Whether browser network/proxy policy prevents private-address rebinding/SSRF after DNS validation.
- Whether any live public observation would produce truthful `OBSERVED` evidence; no page was opened.

## Acceptance mapping

- **A2:** PASS (bounded capability discovery). A real Camoufox executable and documented headless/remote-control flags are present; the safe isolated observer connection remains unproven and must use a fresh dedicated profile plus an injected isolated adapter.
- **C1:** PASS. No source, integration, canonical, main, or worker branch was modified.
- **C2:** PASS. No browser/profile start/stop, login, click, social mutation, or ORCA restart.
- **C3:** PASS. No cookies, passwords, tokens, or raw profile credentials were read or emitted; sensitive profile files were identified by filename only.
- **C4:** PASS (inspection only). No command/publication state was changed; the existing observer seam preserves `NOT_EVALUATED` publication semantics.
- **C5:** PASS. No merge or deploy was attempted.
- **V4:** PASS. Findings above are labeled FACT, INFERENCE, and UNKNOWN and cite direct local observations.

## Recommended bounded next step

Keep the current backend `UNKNOWN` until a human-approved implementation supplies a disposable isolated profile, a bounded local transport/client, and an explicit readiness probe. Do not pass an existing default profile into public observation and do not claim runtime `READY` from executable discovery alone.

## Required completion fields

- Outcome: discovered cached Camoufox executable and CLI capability; no safe live connection attested.
- Files changed: `plans/autonomous-build/distribution-os-runtime-wave-3/reports/camoufox-runtime-wave3.md` only.
- Verification evidence: version/full-version/help probes; process check; metadata-only profile inspection; no browser process remained.
- Limitations: no launch, profile creation, debugger/Marionette connection, public navigation, or network observation.
- Remaining task: build and independently verify a disposable-profile isolated adapter before promoting Camoufox health beyond `UNKNOWN`.

Status: DONE_WITH_CONCERNS
Summary: Cached Camoufox 156.0.1-beta.36 is installed and exposes headless plus debugger/Marionette CLI flags, but the RC has no executable adapter and existing profiles contain persistent credential stores. Safe public observation is connectable only through a future disposable-profile injected adapter; live readiness remains UNKNOWN.
