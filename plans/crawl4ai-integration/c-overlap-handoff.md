# C overlap handoff

Observed C HEAD: `da0301dc5cc91e9db91bb9e23aaf12a4f8eea3ff` in `/Users/nam/Documents/marketing-seeding-session-c-reconciled`.

## Files requiring C-owned merge

- `.env.example`: add `SEEDING_LISTENING_BACKEND` and optional `SEEDING_LISTENING_PYTHON`.
- `.gitignore`: ignore the pinned venv, local goal state, and Python cache.
- `package.json`: add the `listening` product entrypoint.
- `src/discovery-observer.mjs`: export `resolvePublicUrl`/`pinnedFetch`; preserve C's DNS lookup callback behavior.
- `src/discovery.mjs`: retain listening content hash, extractor revision, source refs, fetch coverage, record type, parent ID, and untrusted provenance.
- `src/oi-browser-integration.mjs`: pass bounded `analysisInput`, digest, and evidence refs into the existing provider route while preserving C's provider-analysis normalization and caller-cancellation changes.
- `src/oi-browser-provider-adapters.mjs`: retain C's credential redaction/source URL validation and bound the listening payload; do not replace C's safer normalization with a raw prompt formatter.
- `test/oi-browser-provider-adapters.test.mjs`: combine C's secret-redaction/deadline coverage with D's assertion that observed content reaches the local provider.

## Integration order

1. Apply the D checkpoint commit to C's current HEAD.
2. Merge the eight overlap files serially, preserving C's current provider redaction and cancellation behavior.
3. Run the focused listening/provider/discovery tests, then the full project regression.
4. Re-run the real public-read smoke only from the integrated C runtime; keep the D candidate receipt labeled candidate evidence until then.

No C/A/B worktree was edited by D. No credentials, cookies, profiles, authenticated state, publication, or external writes were used.
