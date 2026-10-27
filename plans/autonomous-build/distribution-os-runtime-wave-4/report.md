# Distribution OS Runtime Wave 4 — Camoufox backend scout

## Scope and safety

Bounded read-only feasibility inspection on `/Users/nam/Documents/marketing-seeding-wave-rc` at RC commit `8dd9748` (`wave/distribution-os-runtime-rc`). No Camoufox process, browser/profile, public URL, debugger endpoint, Marionette session, login, authenticated/social page, or network target was opened. No existing profile contents were read. No source adapter was added; only this report was written.

## FACT

- RC source already has an explicit fail-closed seam:
  - `src/browser-runtime-transports.mjs` exports `CamoufoxTransport`, accepts an injected `client`/`probe`, and reports `UNKNOWN` when no probe is supplied.
  - `src/camoufox-public-observer.mjs` requires an injected transport with `isolated === true` and `observePublic()`, validates public HTTP(S)/DNS destinations, bounds text and links, and preserves `publication.status = NOT_EVALUATED`.
  - `src/browser-runtime-router.mjs` routes public discovery/research/demo/screenshot/publication verification workloads to `camoufox`.
- Target `package.json`/`pnpm-lock.yaml` declare optional `playwright-core` (`^1.56.0`, lock resolves `1.64.0`) and `cloakbrowser` (`^0.6.0`), but this RC has no `node_modules`; `require.resolve('playwright-core')`, `require.resolve('cloakbrowser')`, and `require.resolve('puppeteer-core')` all report absent. No Camoufox Node package or Marionette client is declared.
- A cached arm64 executable exists at `$HOME/Library/Caches/Camoufox/browsers/official/156.0.1-beta.36-0ad5663e/Camoufox.app/Contents/MacOS/camoufox`. `file` identifies a Mach-O arm64 binary; read-only `--version` reports `Camoufox 156.0.1-beta.36`; `--full-version` reports build/platform IDs. No process remained after these commands.
- Read-only `--help` documents `--headless`, `--profile <path>`, `--start-debugger-server [ws:][ <port> | <path> ]`, and `--marionette`. The help command emitted a `ContextualIdentityService.sys.mjs` warning but exited 0. This is CLI capability evidence only.
- A separate, unrelated product environment (`products/any-auto-register/.venv`) contains Python `camoufox==0.5.8`, `playwright==1.62.0`, and `patchright==1.64.1`; its Camoufox wrapper launches via Python Playwright with `executable_path` and `persistent_context` options. This environment is outside the RC dependency graph and was inspected without importing a browser process or using its profiles.
- The Python Camoufox package metadata requires Playwright `<1.63` and exposes a launch wrapper; no installed Python `selenium`, `marionette_driver`, or generic websocket client was found in that environment.
- Existing Camoufox application metadata/profiles are not a safe backend target: prior wave evidence records persistent credential stores (`cookies.sqlite`, `logins.db`, `key4.db`, etc.). This scout did not open or reuse them.

## INFERENCE

- A real isolated observer can fit the current seam only through a new injected adapter that owns a fresh disposable profile, enforces public-only destination/egress policy, bounds navigation/evidence, and implements `observePublic()` plus a read-only readiness probe. Existing `CamoufoxTransport` and `observePublicWithCamoufox` are adequate boundary contracts.
- The installed executable's `--start-debugger-server` is Firefox DevTools/remote-debugger capability, not evidence of Playwright/CDP compatibility. Playwright's Firefox `connect()` expects the Playwright Juggler protocol; Chrome `connectOverCDP()` is not applicable to Camoufox. Marionette requires a separate protocol client and an explicit handshake/command implementation. Therefore the exact remote protocol needed for an injected Node adapter is not established by `--help` alone.
- The Python Camoufox + Playwright stack proves a potentially usable launch path in another environment, but connecting it to this Node service would require a cross-process bridge and dependency/runtime policy that do not exist in the RC. Reusing that environment or adding a subprocess bridge would exceed this bounded scout and could not attest public-only egress without a disposable-profile smoke.

## UNKNOWN

- Whether this exact cached binary can launch with a newly created disposable profile under the current host runtime.
- Whether its debugger server speaks a protocol accepted by any available client, and whether that protocol exposes the DOM/text/link extraction needed by `observePublic()`.
- Whether Marionette is compiled/configured to expose a usable local endpoint and which framing/handshake version applies to this Camoufox build.
- Whether the Python wrapper's Playwright protocol is compatible with the cached `156.0.1-beta.36` executable when invoked outside its own package lifecycle.
- Whether browser-level egress can prevent DNS rebinding/private-address navigation after the existing URL validator.

## Feasibility decision

**Status: BLOCKED (narrow external/runtime fact).** The next implementation is software-remediable after a protocol/dependency decision, but it is not safely implementable in this RC today. The blocker is missing target-side Node Playwright/Camoufox client dependencies plus the absence of a verified debugger/Marionette protocol contract. Do not promote Camoufox health above `UNKNOWN`, do not pass an existing profile, and do not claim observed evidence from executable discovery.

No tiny adapter seam was added because the current seam is already explicit and fail-closed; adding a speculative protocol client would create unverified browser control and violate the bounded scope.

## Verification evidence

Safe local checks only:

- `git rev-parse HEAD` → `8dd974837a6baa9c148687603b12525fe44c18d5`.
- `node` module resolution in the RC → `playwright-core ABSENT`, `cloakbrowser ABSENT`, `puppeteer-core ABSENT`.
- Cached executable `--version`, `--full-version`, and `--help` completed successfully; no process remained.
- Python package metadata/import discovery in the separate any-auto-register venv found `camoufox 0.5.8`, `playwright 1.62.0`, `patchright 1.64.1`; no browser was launched.
- No test suite was run and no network endpoint was contacted, per bounded scout scope.

## Required completion fields

- **Outcome:** Cached Camoufox executable and CLI remote-control flags are present; target RC has no installed Node client and no verified debugger/Marionette adapter. Isolated observer connection remains unproven.
- **Files changed:** `plans/autonomous-build/distribution-os-runtime-wave-4/report.md` only.
- **Verification evidence:** Version/full-version/help probes; Node dependency resolution; separate venv package metadata/import inspection; no browser/profile/network operation.
- **Limitations:** No executable launch, disposable profile creation, debugger/Marionette connection, public navigation, egress test, or observation.
- **Remaining task:** Choose and document a supported protocol/client (Node Playwright with Camoufox-compatible Juggler, or a bounded Marionette/DevTools client), install it in this RC, then obtain human-approved disposable-profile smoke evidence before implementing the adapter.

Status: BLOCKED
Summary: Camoufox binary is installed and exposes debugger/Marionette flags, while the RC lacks an installed Node client and exact protocol contract. Keep the provider `UNKNOWN`; next work is dependency/protocol remediation followed by disposable-profile-only verification.
