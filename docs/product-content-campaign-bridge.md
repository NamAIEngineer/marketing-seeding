# Product content to campaign bridge

`src/product-content-campaign-bridge.mjs` converts one successful
`runProductContentPipeline` result into a strict, hash-bound action plan. The
bridge is read-only: it re-reads the report, copy JSON, MP4, and product source
bytes; it does not copy files, mutate campaign state, create posts, queue work,
publish, or call a remote service.

## Contract

```js
import { bridgeProductContentPipelineResult } from './src/product-content-campaign-bridge.mjs';

const plan = await bridgeProductContentPipelineResult({
  result, // status: "SUCCEEDED" result from runProductContentPipeline
  campaignId: campaign.id,
  productRepo: campaign.productRepo,
  artifactRelativePath: `artifacts/product-content/${result.runId}.mp4`,
  audience: 'builders',
  callToAction: 'Inspect the evidence.'
});
```

The result is `status: "READY"` with:

- one `artifact` containing the MP4 SHA-256, byte count, source path, and
  campaign-repository destination; `artifact.registerInput` matches the
  existing `service.registerArtifact(campaignId, input, actor)` API;
- one grounded `story.input` with the artifact reference, source paths, and
  expected source hashes;
- one `candidates[]` entry per pipeline target. Each entry has a deterministic
  `contentId`, `contentIdentity`, `contentHash`, target/channel identity,
  claim/evidence references, source path/hash references, and `status: "draft"`.
  The bridge currently accepts `linkedin` and `threads`, the intersection of
  channels supported by this pipeline and the campaign service registry.
  Pipeline X/Twitter copies remain export-only until the core service registers
  that channel;
- typed `actions` and `serviceCalls` for staging, registering, story creation,
  and channel draft fan-out. `createStory` resolves the artifact ID returned by
  `registerArtifact`; `createChannelDrafts` resolves the story ID returned by
  `createStory`.

The bridge identity and action idempotency keys are deterministic for the same
campaign, destination, MP4 hash, and target copy set. The bridge has no side
effects. The integration caller must use these keys to reconcile an already
staged/registered artifact or existing story/drafts before retrying a service
call. A same-path different-hash artifact is a conflict and must stop.

## Worker A integration recipe

Worker A owns the integration checkout and should keep the shared service and
server files there. The call sequence is:

1. Run the pipeline through the existing `SeedingService.runProductContentPipeline` seam.
2. Call this bridge with the campaign's canonical `productRepo` and an
   artifact destination relative to that repository.
3. Reconcile `plan.actions.stageArtifact.idempotencyKey`. If the destination
   already exists, hash it and require the exact `expectedSha256` and
   `expectedBytes`; otherwise copy `stageArtifact.sourcePath` to the destination
   with restrictive local permissions, then hash again. The bridge deliberately
   leaves this file operation to the integration owner.
4. Call `service.registerArtifact(campaignId, plan.actions.registerArtifact.input,
   actor)`, reusing an existing artifact only when campaign, relative path, and
   SHA-256 all match. Keep the returned `artifact.id`.
5. Resolve `plan.actions.createStory.input.artifactId` to that artifact ID and
   call `service.createStory(campaignId, storyInput, actor)`. If an exact story
   identity is already present, reuse it; conflicting artifact/source hashes
   fail closed.
6. Resolve `plan.actions.createChannelDrafts.storyIdRef` to the story ID and
   call `service.createChannelDrafts(storyId, plan.actions.createChannelDrafts.input,
   actor)`. Reconcile by each variant's `contentId`/target identity before a
   retry. Existing campaign authorization, readiness, schedule, quota,
   duplicate, and platform guards remain the authority for queue eligibility.

`createChannelDrafts` is the existing draft/standing-authority seam. The bridge
does not add per-post approval and does not create or renew campaign authority.
An active exact standing authorization can queue eligible child jobs through the
existing service scheduler; inactive, stale, ambiguous, or mismatched authority
remains blocked by that service.

## Fail-closed checks

The bridge rejects failed or side-effectful results; missing, stale, malformed,
or ambiguous report/copy/MP4 output; source paths outside `productRepo`; changed
source bytes; MP4 hash/byte mismatches; duplicate target outputs; unknown claim
or evidence references; non-draft copies; and copy fields that claim a URL,
publication timestamp, permalink, engagement, or metrics. Remote-only evidence
with no repository-relative source cannot be converted into the existing
repository-grounded story contract and is rejected.

No result contains a publication URL, metrics, approval, live authorization,
or inferred publication status. MP4 staging is the only planned filesystem
effect, and it is explicit in `actions.stageArtifact` rather than performed by
the bridge.

Focused proof:

```sh
node --test test/product-content-campaign-bridge.test.mjs
```

