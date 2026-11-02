# Mission 20 installed CLI/API discovery

Timestamp: 2026-11-02

Installed official app binaries:

- `~/Applications/designos.app/Contents/MacOS/designos`
- `~/Applications/designos.app/Contents/MacOS/designos-mcp`
- `~/Applications/designos.app/Contents/MacOS/designos-studio`
- `~/Applications/designos.app/Contents/MacOS/designos-diff`

Versions:

- `designos 0.7.6`
- `designos-mcp 0.7.6`

Read-only CLI help succeeded. Supported headless operations include `--inspect-json`, `--export-spec`, `--apply-spec`, and `--screenshot`.

Scoped file probe:

```text
$ designos <scoped>/dashboard-01.designos --inspect-json
exit=2
 designos: Invalid designos file: EOF while parsing a value at line 1 column 0
```

The required blank file is intentionally 0 bytes. CLI cannot inspect or mutate it until a valid DesignOS document serialization exists. No command was run with `--apply-spec` against this blank file because that would require a valid document bootstrap and would not constitute verified stepwise creation from the named blank file.

MCP probe:

```text
$ designos-mcp --workspace <scoped-worktree>
stdin EOF => Error: ConnectionClosed("initialize request")
```

No MCP JSON-RPC initialize or mutation was attempted. No usable API path was established for the scoped blank file.

No foreign process, worktree, canonical manifest/draft, or media artifact was changed. No video capture produced.

Status: BLOCKED_NO_VALID_DOCUMENT_BOOTSTRAP_AND_AGENTS_BINDING
