import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore, migrateState } from "../src/store.mjs";

test("v1 state migrates additively to v8 without dropping existing records", () => {
  const original = { schemaVersion: 1, revision: 4, campaigns: [{ id: "c1" }], auditLog: [] };
  const { state, changed } = migrateState(original, new Date("2026-10-07T00:00:00.000Z"));
  assert.equal(changed, true);
  assert.equal(state.schemaVersion, 8);
  assert.deepEqual(state.campaigns, [{ id: "c1" }]);
  assert.deepEqual(state.campaignAuthorizations, []);
  assert.deepEqual(state.liveExecutionGrants, []);
  assert.deepEqual(state.submissionUncertainties, []);
  assert.deepEqual(state.oneTimeExecutionWindows, []);
  assert.deepEqual(state.executionAccounts, []);
  assert.deepEqual(state.executionRequests, []);
  assert.deepEqual(state.executionReceipts, []);
  assert.deepEqual(state.executionLeases, []);
  assert.deepEqual(state.listeningJobs, []);
  assert.deepEqual(state.artifacts, []);
  assert.deepEqual(state.stories, []);
  assert.equal(state.revision, 5);
  assert.equal(state.auditLog.at(-1).event, "state_schema_migrated_v8");
});

test("store accepts a UTF-8 BOM state and persists schema v8", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "seeding-migrate-"));
  const file = path.join(dir, "state.json");
  await writeFile(file, `\uFEFF${JSON.stringify({ schemaVersion: 1, revision: 0, campaigns: [], auditLog: [] })}`, "utf8");
  const state = await new JsonStore(file).init();
  assert.equal(state.schemaVersion, 8);
  assert.doesNotMatch(await readFile(file, "utf8"), /^\uFEFF/);
});

test("schema v2 migrates to v8 in an isolated fixture and preserves legacy approvals without promoting them", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "seeding-v2-v8-migrate-"));
  const file = path.join(dir, "state.json");
  const original = {
    schemaVersion: 2, revision: 9,
    campaigns: [{ id: "campaign-legacy", status: "active" }],
    posts: [{ id: "legacy-post", campaignId: "campaign-legacy", status: "approved", approvedAt: "2026-10-01T00:00:00.000Z" }],
    auditLog: [{ id: "prior-audit", event: "legacy" }]
  };
  await writeFile(file, JSON.stringify(original), "utf8");
  const state = await new JsonStore(file).init();
  assert.equal(state.schemaVersion, 8);
  assert.equal(state.revision, 10);
  assert.deepEqual(state.campaigns, original.campaigns);
  assert.deepEqual(state.posts, original.posts);
  assert.deepEqual(state.campaignAuthorizations, []);
  assert.deepEqual(state.submissionUncertainties, []);
  assert.deepEqual(state.oneTimeExecutionWindows, []);
  assert.equal(state.posts[0].approvedAt, original.posts[0].approvedAt);
  assert.equal(state.auditLog.at(-1).event, "state_schema_migrated_v8");
  const backup = JSON.parse(await readFile(`${file}.schema-v8.bak`, "utf8"));
  assert.deepEqual(backup, original);
});

test("schema v3 retains campaign authorization and adds execution collections", () => {
  const authorization = { id: "auth-v3", campaignId: "campaign-v3", status: "active" };
  const { state, changed } = migrateState({ schemaVersion: 3, revision: 2, campaignAuthorizations: [authorization], auditLog: [] });
  assert.equal(changed, true);
  assert.equal(state.schemaVersion, 8);
  assert.deepEqual(state.campaignAuthorizations, [authorization]);
  assert.deepEqual(state.executionAccounts, []);
  assert.deepEqual(state.executionRequests, []);
  assert.deepEqual(state.executionReceipts, []);
  assert.deepEqual(state.executionLeases, []);
});

test("schema v4 adds execution leases without dropping PR2 state", () => {
  const request = { executionId: "exec-v1", state: "REQUEST_READY" };
  const { state, changed } = migrateState({ schemaVersion: 4, revision: 3, executionRequests: [request], auditLog: [] });
  assert.equal(changed, true);
  assert.equal(state.schemaVersion, 8);
  assert.deepEqual(state.executionRequests, [request]);
  assert.deepEqual(state.executionLeases, []);
});

test("schema v5 gains empty grants and uncertainty storage without inferring live permission", () => {
  const { state } = migrateState({ schemaVersion: 5, revision: 9, campaignAuthorizations: [{ id: "auth", allowLiveExecution: true }], auditLog: [] });
  assert.equal(state.schemaVersion, 8);
  assert.deepEqual(state.liveExecutionGrants, []);
  assert.deepEqual(state.submissionUncertainties, []);
  assert.deepEqual(state.oneTimeExecutionWindows, []);
  assert.equal(state.campaignAuthorizations[0].allowLiveExecution, true);
});

test("schema v6 adds an empty unknown-submission quarantine collection and preserves all v6 data", () => {
  const old = {
    schemaVersion: 6, revision: 21, campaigns: [{ id: "c" }], posts: [{ id: "p", status: "publishing" }],
    campaignAuthorizations: [{ id: "a" }], executionRequests: [{ executionId: "e" }], liveExecutionGrants: [], auditLog: []
  };
  const { state, changed } = migrateState(old);
  assert.equal(changed, true);
  assert.equal(state.schemaVersion, 8);
  assert.deepEqual(state.campaigns, old.campaigns);
  assert.deepEqual(state.posts, old.posts);
  assert.deepEqual(state.campaignAuthorizations, old.campaignAuthorizations);
  assert.deepEqual(state.executionRequests, old.executionRequests);
  assert.deepEqual(state.submissionUncertainties, []);
  assert.deepEqual(state.oneTimeExecutionWindows, []);
  assert.equal(state.auditLog.at(-1).event, "state_schema_migrated_v8");
});

test("schema v7 migrates additively to v8 with an empty one-time window collection", () => {
  const old = {
    schemaVersion: 7, revision: 30,
    campaigns: [{ id: "campaign" }], posts: [{ id: "job", status: "blocked" }],
    campaignAuthorizations: [{ id: "auth" }], liveExecutionGrants: [{ grantId: "grant" }],
    submissionUncertainties: [{ uncertaintyId: "uncertain" }], executionRequests: [{ executionId: "exec" }],
    executionReceipts: [{ executionId: "exec" }], executionLeases: [], targets: [{ id: "target" }], auditLog: []
  };
  const { state, changed } = migrateState(old);
  assert.equal(changed, true);
  assert.equal(state.schemaVersion, 8);
  assert.deepEqual(state.oneTimeExecutionWindows, []);
  for (const key of ["campaigns", "posts", "campaignAuthorizations", "liveExecutionGrants", "submissionUncertainties", "executionRequests", "executionReceipts", "targets"]) {
    assert.deepEqual(state[key], old[key]);
  }
  assert.equal(state.auditLog.at(-1).event, "state_schema_migrated_v8");
});

test("legacy state migration creates an inactive kill switch at epoch zero without dropping control metadata", () => {
  const { state, changed } = migrateState({
    schemaVersion: 7,
    revision: 4,
    control: { killSwitch: { active: true, epoch: 12, changedAt: "2026-10-17T00:00:00.000Z", changedBy: "operator", reason: "maintenance" } },
    campaigns: [], auditLog: []
  });
  assert.equal(changed, true);
  assert.deepEqual(state.control.killSwitch, {
    active: true,
    epoch: 12,
    changedAt: "2026-10-17T00:00:00.000Z",
    changedBy: "operator",
    reason: "maintenance"
  });
});

test("migration defaults a missing kill switch control fence safely", () => {
  const { state, changed } = migrateState({ schemaVersion: 7, revision: 4, campaigns: [], auditLog: [] });
  assert.equal(changed, true);
  assert.deepEqual(state.control.killSwitch, {
    active: false,
    epoch: 0,
    changedAt: null,
    changedBy: null,
    reason: null
  });
});

test("migration rejects a future schema instead of downgrading it", () => {
  assert.throws(() => migrateState({ schemaVersion: 9, revision: 9 }), /newer than supported/);
});

test("runtime writer lease fences a second process/store owner", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "seeding-lease-"));
  const file = path.join(dir, "state.json");
  const first = new JsonStore(file, { requireLease: true });
  await first.acquireWriterLease();
  await first.init();
  const second = new JsonStore(file, { requireLease: true });
  await assert.rejects(second.acquireWriterLease(), /already held/);
  await first.releaseWriterLease();
  await second.acquireWriterLease();
  await second.releaseWriterLease();
});
