# Marketing Seeding OS for macOS

`build-macos.sh` packages the existing local server and verified frontend into
`Marketing Seeding OS.app`. The app owns a native macOS window containing the
local web Overview. A per-user LaunchAgent keeps the loopback Node service
running while the window is open; runtime state and bearer tokens stay under
`~/Library/Application Support/Marketing Seeding OS` with restrictive file
permissions.

Build on macOS with Node.js 22 or newer:

```sh
sh desktop/build-macos.sh
open "desktop/dist/Marketing Seeding OS.app"
```

The package includes the server, public UI, listening worker entrypoints, and
the exact source commit used to build it. Crawl4AI and nodriver remain optional
local backends: the app never fabricates listening, Camoufox, media, or
publication evidence when those runtimes are unavailable. All existing account,
authority, UNKNOWN quarantine, and final publication gates remain in force.

On first service start, the bundle looks for the pinned `9router@0.5.109`
binary. It uses an existing verified binary when present; otherwise it provisions
that exact npm version in the app's protected runtime directory and starts it on
loopback. The 9Router dashboard still owns provider login and API-key creation:
the app cannot complete that human-authenticated step, so Overview reports
`CONNECT_REQUIRED` until the user supplies an app-scoped API key through the
operator connect action. The key is stored with mode `0600`; provider keys and
dashboard passwords are never read or copied.

Model choices come only from the authenticated live `/v1/models` catalog. The
catalog does not prove remaining quota, so quota is shown as `UNVERIFIED` until
an actual model request supplies evidence. Authentication or entitlement
failures are separated from rate limits and receive cooldowns to avoid repeated
failing calls. No hard-coded plan labels are used.

The autonomous lane remains governed by standing authority, exact account
binding, schedules, quotas, platform rules, UNKNOWN quarantine and kill switch.
Each social account has an isolated Account Agent projection; All Social is
fan-out only to eligible account agents, with per-account failure isolation.
This branch does not claim live multi-account publication without provider
evidence.

`update-macos.sh` is the reversible update seam: HTTPS release download,
SHA-256 pin, strict code-signature verification, previous app/state backup and
atomic staged swap with rollback on rename failure. Overview displays discovery,
signature, checksum and installer eligibility. After the operator connects the
local session, the install action invokes the bundled updater only when all
gates pass; malformed manifests fail closed and a successful swap shuts down
the service for relaunch. Discovery remains read-only by default because this
checkout has no signed release manifest, installer configuration or Apple
signing identity.

For release builds, set `SEEDING_CODESIGN_IDENTITY` to a Developer ID
Application identity before running `build-macos.sh`; the script then signs the
bundle with hardened runtime and a timestamp. Notarization and stapling still
require the owner's Apple Developer credentials and an external `notarytool`
submission. If a stored notary profile is available, set
`SEEDING_NOTARY_PROFILE` and the build submits, waits for approval, staples the
bundle and regenerates the ZIP. No such credentials were available for this
artifact.
