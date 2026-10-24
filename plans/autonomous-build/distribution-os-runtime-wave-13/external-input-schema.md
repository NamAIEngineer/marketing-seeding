# Fresh LinkedIn certification input

Provide one fresh, exact, harmless certification scope. Software derives all
IDs, hashes, timestamps, windows, grants, leases, and execution identities from
this input. Do not provide cookies, passwords, access tokens, or raw session
secrets.

```json
{
  "account": {
    "platform": "linkedin",
    "accountId": "<authorized account id>",
    "profileReference": "<authorized GPM profile reference>",
    "expectedIdentityUrl": "https://www.linkedin.com/in/<authorized-identity>",
    "sessionAuthorityReference": "<operator/provider authority reference>"
  },
  "target": {
    "targetId": "<fresh exact target id>",
    "url": "https://www.linkedin.com/feed/",
    "permission": "<permission reference>"
  },
  "contentPolicy": {
    "approvedPayloadBytes": "<exact harmless UTF-8 payload>",
    "audience": "PUBLIC",
    "media": [],
    "claimEvidenceReferences": [],
    "disclosure": "<optional disclosure>"
  },
  "authorization": {
    "standingAuthorizationReference": "<fresh standing authority reference>",
    "allowLiveExecution": true,
    "validFrom": "<UTC ISO-8601>",
    "validUntil": "<UTC ISO-8601>",
    "dailyQuota": 1,
    "minimumIntervalSeconds": null,
    "concurrency": 1
  },
  "session": {
    "provider": "gpm",
    "hostAttestationReference": "<fresh host/provider attestation reference>"
  }
}
```

Required facts: account/profile/session permission, target permission, exact
approved harmless bytes and media policy, UTC validity bounds, standing
authorization reference, quota/cadence/concurrency. Resolve MFA/security
challenge only if the provider presents one. No historical execution, grant,
window, lease, content hash, or publication identity may be reused.
