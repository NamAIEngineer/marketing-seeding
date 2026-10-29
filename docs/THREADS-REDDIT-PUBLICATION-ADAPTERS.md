# Threads and Reddit Camoufox publication adapters

`src/threads-reddit-publication-adapters.mjs` exports two contract-v1 platform adapters:

```js
import { THREADS_ADAPTER, REDDIT_ADAPTER } from "./threads-reddit-publication-adapters.mjs";

registry.register("threads", THREADS_ADAPTER);
registry.register("reddit", REDDIT_ADAPTER);
```

`getThreadsRedditAdapter(platform)` resolves the shared singleton. `createThreadsRedditAdapter(platform, options)` creates an adapter with an injected `browserSurface`, `transport`, `verifier`, clock and timeout. Worker A should inject the exact Camoufox `executionSession.browserSurface` and `executionSession.transport` already acquired for the request; the adapter never creates a session or reads credentials.

## Execution contract

`execute(request, options)` accepts a validated `ExecutionRequestV1`. It requires exact provider/account/profile/identity and target binding, fresh READY readiness, campaign authorization, and a live grant for a non-dry-run call. The page evidence gates independently prove owner identity, target URL, membership/posting rights, unique composer/editor/submit control, exact content hash and (when present) local artifact hash, MIME type, upload and preview readiness.

Before the irreversible control input, the adapter calls `beforeSubmitIntent(verifiedGates, submitBoundaryEvidence)`. It then invokes the caller's transport click exactly once and calls `onSubmitSent(clickAcceptanceEvidence)`. A completed click remains `UNKNOWN` until an independently observed permalink, stable post ID, author identity, exact content, target and bounded timestamp match; no URL, reference, metric or published state is fabricated.

Repeated calls with the same idempotency key return the prior result with `duplicate: true` and never click again. If a click command or its outcome is uncertain, the adapter returns `UNKNOWN`; worker reconciliation must call `reconcile(request, { account, submittedAt, preSubmitMediaIntegrity, browserSurface, transport })`, never redispatch `execute`.

## Blocked and unsupported cases

Challenge, CAPTCHA/MFA, login-required, rate-limit, blocked membership/rights, wrong account/profile/identity/target, stale readiness, missing authority/grant, ambiguous composer or missing verification all fail closed. The adapter never bypasses a platform challenge, stores credentials, logs secrets, marks a post published from click evidence, or claims post-publish media hash when the platform does not expose one.

## Verification limits

The tests use synthetic Camoufox protocol fixtures only. They prove callback ordering, duplicate suppression, exact identity/target checks, challenge and membership stops, hash-bound media gates, independent evidence requirements and no permalink fabrication. They do not establish live Threads or Reddit selectors, account state, moderation acceptance, permalink formats, or owner credentials.
