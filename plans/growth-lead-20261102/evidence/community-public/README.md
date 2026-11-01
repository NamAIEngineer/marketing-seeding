# Public community discovery artifact

Generated `community-public-discovery-20261102.json` contains 30 deterministic public candidate rows: 15 Facebook Groups and 15 LinkedIn Groups.

- Generator: `generate-public-discovery.mjs`
- Capture marker: `2026-11-02T01:20:00+07:00`
- Receipt SHA-256: `b82e14d4872ae37a825c951bcd6b149a559e069be23d78218f4a23a00bcf72e5`
- Source class: `public_candidate_fixture_seed`
- Authenticated reads: `0`
- External side effects: `false`
- Membership, approval, rules, activity, and postability: `UNKNOWN`

Rows are passed through `src/community-engine.mjs` `scoreCommunity()` and `projectJoinIntents()`. They are prioritization candidates only. No login, credential, cookie, membership data, join request, message, or publication occurred.
