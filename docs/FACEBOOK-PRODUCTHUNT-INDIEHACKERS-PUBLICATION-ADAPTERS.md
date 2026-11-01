# Facebook Group, Product Hunt, and Indie Hackers publication adapters

`src/facebook-producthunt-indiehackers-publication-adapters.mjs` exports three contract-v1 Camoufox adapters:

```js
import {
  FACEBOOK_GROUP_ADAPTER,
  PRODUCT_HUNT_ADAPTER,
  INDIE_HACKERS_ADAPTER
} from "./facebook-producthunt-indiehackers-publication-adapters.mjs";

registry.register("facebook_group", FACEBOOK_GROUP_ADAPTER);
registry.register("product_hunt", PRODUCT_HUNT_ADAPTER);
registry.register("indie_hackers", INDIE_HACKERS_ADAPTER);
```

## Contract

The adapters accept the existing `ExecutionRequestV1` plus an acquired Camoufox `executionSession` (`browserSurface` and `transport`) and the caller's durable lifecycle callbacks:

```js
adapter.execute(request, {
  account,
  executionSession,
  browserSurface: executionSession.browserSurface,
  transport: executionSession.transport,
  beforeSubmitIntent,
  beforeProviderSend,
  onSubmitSent
});
```

They require exact account/profile/identity/target binding, fresh READY readiness binding, standing authorization, a live grant for non-dry-run execution, explicit membership and posting rights, and visible community rules evidence. Content and media remain SHA-256 bound. `beforeSubmitIntent` executes before the single irreversible click; idempotency suppresses duplicate clicks, and uncertain submit outcomes remain `UNKNOWN` for reconciliation.

Independent verification requires an allowlisted platform permalink, stable publication ID, exact author identity path, target path, content hash, timestamp, and media proof where supplied. A click cannot produce `PUBLISHED`; the adapter never fabricates URLs, references, metrics, or moderation results. Challenge/CAPTCHA/MFA, blocked membership, wrong account/target, ambiguous UI, missing authority, missing rules, and missing verification fail closed.

## Platform evidence

| Platform | Owner identity proof | Target and rights proof | Publication path evidence |
| --- | --- | --- | --- |
| `facebook_group` | `https://facebook.com/<username>` or `/profile.php?id=<digits>` from owner navigation surface | `/groups/<name>`, explicit membership/posting markers, reviewed rules marker, unique composer | `/groups/<name>/posts/<id>` or permalink form |
| `product_hunt` | `https://producthunt.com/@<username>` from owner navigation surface | `/posts/<slug>` or `/products/<slug>`, explicit rights and rules marker, unique composer | `/posts/<slug>/comments/<id>` or equivalent allowlisted post/comment path |
| `indie_hackers` | `https://indiehackers.com/u/<username>` from owner navigation surface | `/groups/<slug>` or supported community target, explicit rights and rules marker, unique composer | supported group/user post path with stable ID |

Selectors are intentionally bounded to visible owner links, explicit rights/rules attributes, and unique composer controls. Generic home text does not establish identity or posting rights.

## Registry integration

Worker A should register the three exported singleton adapters in the existing `PlatformAdapterRegistry`. For each request, pass the exact session acquired for the same platform/account/profile and forward durable intent, provider-send, and submit-sent callbacks. On `UNKNOWN`, call `adapter.reconcile(request, { account, submittedAt, preSubmitMediaIntegrity, browserSurface, transport })` with the original session; do not redispatch `execute`.

Focused synthetic protocol fixtures cover registry contract, allowed verified evidence, challenge, wrong account/target, missing authority, blocked rights/rules, intent ordering, duplicate suppression, and incomplete verification. They do not prove live selectors, account state, moderation acceptance, or owner credentials; live staging publish remains worker A's responsibility.
