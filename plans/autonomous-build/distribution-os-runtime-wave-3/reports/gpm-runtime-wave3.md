# GPM Runtime Inspection — Wave 3

## Acceptance IDs addressed

A1, C1–C5, V4.

## Summary

The installed GPMLoginGlobal runtime is running and exposes a live, unauthenticated-looking local HTTP root response that identifies **GPMLoginGlobal v5.1.2-stable**. The endpoint was discovered from the process's actual listening sockets (`lsof`), not from a guessed port. Root GETs on port 9495 are safe for basic process/API identity and liveness evidence. Port 9496 upgrades HTTP to a WebSocket connection, but its protocol and capability were not established.

A local SQLite profile registry is present and has profile/group records, but its contents were intentionally not read. No supported read-only profile-list endpoint or exact API route contract was established. GPM's app binary contains API/profile service symbols and an API UI module, which suggests a broader local API exists, but symbol strings do not prove endpoint methods, safety, authorization, or stable schema. RC integration can safely use a configured/discovered root endpoint as a bounded GPM identity/liveness probe. It should report profile registry and profile status as UNKNOWN until GPM's documented read-only API routes and access controls are verified.

## Evidence

Commands run from `/Users/nam/Documents/marketing-seeding-wave-rc`:

- `ps aux | rg -i 'gpm|login.?global|anty|ads.?power|go.?login'`
  - **FACT:** PID 3068 is `/Volumes/GPMLoginGlobal Installer/GPMLoginGlobal.app/Contents/MacOS/GPMLoginGlobal`.
- `ps -p 3068 -o pid,ppid,user,lstart,etime,state,command`
  - **FACT:** Process is running (state `S`) since Oct 22, 2026 23:30:41 local host time.
- `lsof -nP -a -p 3068 -i`
  - **FACT:** Process listens on `*:9495` TCP and `*:9496` TCP. The listener is wildcard-bound, not loopback-only.
- `curl -sS --max-time 2` equivalent implemented using Python `urllib.request.Request(..., method='GET')` against `http://127.0.0.1:9495/`, `/api`, `/health`, `/status`, `/swagger`, and `/swagger/v1/swagger.json` with `Accept: application/json`.
  - **FACT:** Each tested path returned HTTP 200 with the same 100-byte response: `{"success":true,"data":"GPMLogin Global API","message":null,"sender":"GPMLoginGlobal v5.1.2-stable"}`. This proves a responsive API identity root, not endpoint-specific health or profile state; those paths appear to fall back to the same response.
- Python `urllib.request.Request(..., method='GET')` against `http://127.0.0.1:9496/`.
  - **FACT:** Returned HTTP 101 Switching Protocols. **UNKNOWN:** WebSocket message schema/capabilities. No WebSocket message was sent.
- `defaults` were not queried; `plutil`/`/usr/libexec/PlistBuddy -c 'Print' /Applications/GPMLoginGlobal.app/Contents/Info.plist` (filtered output).
  - **FACT:** Installed app bundle is `GPMLoginGlobal`, bundle identifier `com.example.GPMLoginGlobal`, bundle version `1.0`, executable `GPMLoginGlobal`.
- `file /Applications/GPMLoginGlobal.app/Contents/MacOS/GPMLoginGlobal`; `codesign -dv --verbose=4 /Applications/GPMLoginGlobal.app`; `otool -L ...`.
  - **FACT:** App executable is arm64 Mach-O and signed; code-signature timestamp is Oct 16, 2026. This is bundle metadata, not vendor/API compatibility proof.
- `strings -a /Applications/GPMLoginGlobal.app/Contents/MacOS/GPMLoginGlobal | rg ...` (filtered symbol search).
  - **FACT:** Binary has `ApiV1Service`, `ApiSetting`, profile/group service symbols, profile request/response serializers, and `ApiPage` UI symbols.
  - **INFERENCE:** App likely implements a richer API than the root identity response. Exact route and method safety cannot be established from these strings alone.
- `sqlite3 "$HOME/Documents/GPM/database.db" "select name from sqlite_master where type='table' order by name;"` and aggregate-only query `select 'profiles',count(*) ...` for profiles/groups/tags/proxies.
  - **FACT:** Database has tables `groups`, `profile_tags`, `profiles`, `proxies`, `proxy_tags`, and `tags`; aggregate counts observed were 2 profiles, 1 group, 0 tags, and 1 proxy. No rows or field values were queried or emitted.
- `find "$HOME/Library/Application Support/GPMLoginGlobal/Browsers" ... -name version` and read those version marker files.
  - **FACT:** Installed browser-core folders include Chromium versions through v154 and Firefox through v154. These are browser-core assets, not the GPM API/server version.
- `git status --short --branch`
  - **FACT:** Before report creation, the only untracked path was the wave-3 plan directory. No source files were changed. This report is the only owned path changed by this worker.

No profile endpoint was called; no profile names/IDs, configuration values, cookies, credentials, tokens, or database rows were read. No process/profile state was changed, and no login or social/browser interaction occurred.

## Confidence

- **High:** GPM process presence, actual socket listeners, localhost root response, API-reported version string, bundle metadata, database schema/table presence, and aggregate record counts at inspection time.
- **Medium:** Root GET is a suitable safe liveness/identity observation. It answers consistently across unrelated paths and discloses only a generic API label/version, but its HTTP listener is bound to all interfaces and no authentication policy was evaluated.
- **Low / UNKNOWN:** Exact documented profile-list route, API authentication requirements, profile status semantics, WebSocket protocol, and production reliability. The root response is not evidence of profile readiness or safe profile discovery.

## Out-of-scope noticed

- Listener 9495 is bound to `*`, so the API may be reachable beyond loopback depending on host networking/firewall. No remote access test or config inspection was performed.
- Port 9496 accepts an HTTP WebSocket upgrade; protocol inspection was out of scope.
- GPM database contains profile/proxy registry state; no record details were accessed.
- Installation alone does not establish production readiness, supported API stability, profile attach, or session health.

## Final status

**DONE_WITH_CONCERNS** — A1 is evidenced for safe runtime identity/liveness discovery via the process-discovered root endpoint. Profile listing/status capability remains UNKNOWN pending authoritative GPM API documentation and authorization/safe-read verification.
