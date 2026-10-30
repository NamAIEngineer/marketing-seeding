# Camoufox platform login adapters

`src/camoufox-platform-login-adapters.mjs` is the standalone login and identity-proof bridge for the configured channels that do not yet have a core Camoufox login descriptor:

- `facebook_group`
- `threads`
- `reddit`
- `product_hunt`
- `indie_hackers`

The module is deliberately independent from `src/camoufox-account-login.mjs`, `src/service.mjs`, `src/server.mjs`, `desktop/`, and `ui/`. Worker A can add it at the existing Camoufox account login call site without changing the core protocol.

## Contract

```js
import {
  loginAccountWithCamoufoxPlatform,
  getCamoufoxPlatformLoginAdapter,
  listCamoufoxPlatformLoginAdapters
} from "../src/camoufox-platform-login-adapters.mjs";

const result = await loginAccountWithCamoufoxPlatform({
  platform: account.platform,
  accountId: account.accountId,
  pageId,
  protocol: camoufoxBrowserSurface,
  expectedIdentity: account.identityReference || account.expectedIdentityUrl,
  credentials: { username, password }, // caller-owned, in memory only
  target: target ? { id: target.id, url: target.url } : undefined
});
```

The same operation is available from the descriptor returned by `getCamoufoxPlatformLoginAdapter(platform).login(input)`. `listCamoufoxPlatformLoginAdapters()` returns the five supported IDs. `normalizeCamoufoxIdentityReference(platform, value)` validates and canonicalizes an expected identity URL without opening a browser.

The input `protocol` uses the existing Camoufox surface methods: `navigate`, `snapshot`, `resolve`, `fill`, `click`, and read-only `evaluate`; an injected `observeIdentity` may be used when `evaluate` is unavailable. The adapter never calls `evaluateMutation`, never clicks a target composer, never submits content, and never creates a publication.

Every result is bounded and secret-free:

- `status`: `READY`, `BLOCKED`, or `UNKNOWN`.
- `identityVerified`: true only after an exact platform identity URL matches the expected identity, the observed candidate is unambiguous, and the evidence comes from the descriptor's owner profile surface.
- `postingRights.status`: `READY`, `BLOCKED`, `UNKNOWN`, or `NOT_CHECKED`; account login readiness never implies target/community rights. For `facebook_group`, `reddit`, `product_hunt`, and `indie_hackers`, `READY` additionally requires explicit accepted rules evidence from the target surface. The sanitized evidence includes `rulesStatus`, `rulesEvidencePresent`, `rulesEvidenceAccepted`, and `rulesEvidenceDenied`; absent or ambiguous rules remain `UNKNOWN`, while denied, pending, or membership-required rules are `BLOCKED`. Threads does not require community-rules evidence because its descriptor is not a group/community target.
- `externalSideEffects: false`, `published: false`, and `publicationReference: null` are always returned.
- `evidence` contains only sanitized source, confidence, candidate-count, owner-surface, challenge, and composer/target markers.

`READY` means account identity proof passed. If a target is supplied, `postingRights` is checked independently after navigation to the exact target URL. Membership, group rules, disabled composer controls, or an explicit blocked marker produce `BLOCKED`; missing or ambiguous rights evidence produces `UNKNOWN`.

## Worker A integration recipe

At the current `loginAccountWithCamoufox` path in `src/camoufox-account-agent.mjs`/core service integration:

1. Keep existing profile acquisition, protocol attachment, lease release, and Keychain retrieval ownership in the caller.
2. For one of the five supported channels, replace the old generic login invocation with `loginAccountWithCamoufoxPlatform({ platform, accountId, protocol, pageId, expectedIdentity, credentials, target })`.
3. Pass credentials directly from the caller's in-memory read result. Do not add credentials to account metadata, protocol options, logs, errors, fixtures, or persisted state.
4. Treat `READY` + `identityVerified` as account/session readiness only. Require `postingRights.status === "READY"` before target publication; keep `BLOCKED`/`UNKNOWN` as the existing human-required or readiness path.
5. Preserve existing standing campaign authorization, schedule, platform, duplicate, rate, and submit-intent guards. This adapter does not grant publication authority.
6. Leave the LinkedIn path on `src/camoufox-account-login.mjs` until its owner chooses to migrate it; the registry intentionally excludes LinkedIn.

A minimal resolver form is:

```js
const adapter = getCamoufoxPlatformLoginAdapter(platform);
const result = adapter
  ? await adapter.login({ platform, accountId, pageId, protocol, expectedIdentity, credentials, target })
  : await loginAccountWithCamoufox(existingInput);
```

## Identity and challenge limits

Identity expressions inspect only visible owner-surface links and the current URL. Generic `Home`, `Feed`, `Profile`, or authenticated-shell text cannot produce `READY`. A wrong account, ambiguous owner links, missing identity URL, login-control failure, or unavailable identity proof remains `UNKNOWN`/`BLOCKED` according to the returned code. CAPTCHA, MFA, checkpoint, security challenge, lock, suspension, or access block returns `BLOCKED` with `nextAction: "HUMAN_REQUIRED"`; the module never attempts to bypass it.

The fixtures are offline protocol doubles. They prove the five descriptor contracts, exact identity matching, challenge detection, generic-home and wrong-account fail-closed behavior, credential non-disclosure, and independent Facebook group rights. They do not prove a live account, membership, moderation permission, platform UI stability, or successful publication; owner credentials and an authorized Camoufox profile are required for those checks.
