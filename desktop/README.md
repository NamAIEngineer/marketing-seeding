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
