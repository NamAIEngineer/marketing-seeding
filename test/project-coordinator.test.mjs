import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProjectCoordinator } from "../src/project-coordinator.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-coordinator-"));
  const calls = [];
  const worker = async (task, context) => {
    calls.push({ taskId: task.taskId, attemptId: context.attemptId, idempotencyKey: context.idempotencyKey });
    const artifactPath = path.join(context.stateRoot, task.artifactPath);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, JSON.stringify({ taskId: task.taskId, rehearsal: true, externalSideEffects: false }));
    return { status: "COMPLETED", artifactPath, workerStatus: "EXECUTED" };
  };
  const coordinator = new ProjectCoordinator({ stateFile: path.join(root, "state.json"), worker, intervalMs: 25 });
  await coordinator.init();
  return { root, coordinator, calls };
}

test("dependency event wakes a real worker and accepts a durable artifact", async () => {
  const { coordinator, calls } = await fixture();
  await coordinator.registerTask({ taskId: "follow-up", owner: "session-c", scope: "integration", dependsOn: ["a-checkpoint"], replaySafe: true });
  assert.equal((await coordinator.runOnce()).status, "IDLE");
  await coordinator.emitDependency({ eventId: "a-checkpoint-event", dependencyId: "a-checkpoint", owner: "session-a", checkpoint: "A-CHECKPOINT-1", requestId: "req-1" });
  const task = await coordinator.waitFor("follow-up");
  assert.equal(task.status, "COMPLETE");
  assert.equal(calls.length, 1);
  const state = coordinator.snapshot();
  assert.ok(state.wakeEvents.some((event) => event.taskId === "follow-up"));
  assert.equal(state.results.length, 1);
  assert.equal(state.results[0].status, "COMPLETED");
});

test("duplicate dependency and restart replay do not execute a completed task twice", async () => {
  const { root, coordinator, calls } = await fixture();
  await coordinator.registerTask({ taskId: "restart-safe", owner: "session-c", scope: "integration", dependsOn: ["checkpoint"], replaySafe: true });
  await coordinator.emitDependency({ eventId: "event-1", dependencyId: "checkpoint", owner: "session-a", checkpoint: "A-1" });
  await coordinator.emitDependency({ eventId: "event-1", dependencyId: "checkpoint", owner: "session-a", checkpoint: "A-1" });
  await coordinator.waitFor("restart-safe");
  const restarted = new ProjectCoordinator({ stateFile: path.join(root, "state.json"), worker: coordinator.worker, intervalMs: 25 });
  await restarted.init();
  await restarted.runOnce();
  assert.equal(calls.length, 1);
  assert.equal(restarted.snapshot().dependencyEvents.length, 1);
  assert.equal(restarted.snapshot().results.length, 1);
});

test("recovery refuses a non replay-safe task left running", async () => {
  const { root, coordinator } = await fixture();
  await coordinator.registerTask({ taskId: "unsafe", owner: "session-c", scope: "integration", replaySafe: false });
  const statePath = path.join(root, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.tasks[0].status = "RUNNING";
  state.tasks[0].attemptCount = 1;
  await writeFile(statePath, JSON.stringify(state));
  const restarted = new ProjectCoordinator({ stateFile: statePath, worker: coordinator.worker });
  await restarted.init();
  assert.equal(restarted.snapshot().tasks[0].status, "FAILED");
  assert.equal(restarted.snapshot().tasks[0].error, "COORDINATOR_RECOVERY_REQUIRES_REPLAY_SAFE_TASK");
  const persisted = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(persisted.tasks[0].status, "FAILED");
  assert.equal(persisted.tasks[0].error, "COORDINATOR_RECOVERY_REQUIRES_REPLAY_SAFE_TASK");
});

test("artifact symlink escape fails closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-coordinator-symlink-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-coordinator-outside-"));
  const artifactDirectory = path.join(root, "artifacts");
  await mkdir(artifactDirectory, { recursive: true });
  const outsideArtifact = path.join(outsideRoot, "outside.json");
  await writeFile(outsideArtifact, JSON.stringify({ externalSideEffects: false }));
  await symlink(outsideArtifact, path.join(artifactDirectory, "escaped.json"));
  const coordinator = new ProjectCoordinator({
    stateFile: path.join(root, "state.json"),
    worker: async () => ({ status: "COMPLETED", artifactPath: "artifacts/escaped.json" })
  });
  await coordinator.init();
  await coordinator.registerTask({ taskId: "symlink-escape", owner: "session-c", scope: "integration", artifactPath: "artifacts/escaped.json" });
  await coordinator.runOnce();
  const task = coordinator.snapshot().tasks[0];
  assert.equal(task.status, "FAILED");
  assert.equal(task.error, "coordinator artifact symlink escapes state root");
});

test("schema v1 state migrates additively and preserves completed history", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-coordinator-migration-"));
  const stateFile = path.join(root, "state.json");
  await mkdir(path.join(root, "artifacts"), { recursive: true });
  const artifact = path.join(root, "artifacts", "done.json");
  await writeFile(artifact, JSON.stringify({ rehearsal: true }));
  await writeFile(stateFile, JSON.stringify({
    schemaVersion: 1,
    coordinatorId: "coord-v1",
    revision: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    tasks: [{ taskId: "done", owner: "session-c", scope: "migration", dependsOn: [], replaySafe: true, artifactPath: "artifacts/done.json", idempotencyKey: "coord:done", status: "COMPLETE", createdAt: "2026-01-01T00:00:00.000Z", attemptCount: 1 }],
    dependencyEvents: [], wakeEvents: [],
    results: [{ taskId: "done", attemptId: "done:attempt:1", status: "COMPLETED", artifactPath: "artifacts/done.json", artifactHash: "fixture", acceptedAt: "2026-01-01T00:00:00.000Z", workerStatus: "EXECUTED" }]
  }));
  const coordinator = new ProjectCoordinator({ stateFile, worker: async () => { throw new Error("must not replay"); } });
  const state = await coordinator.init();
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.tasks[0].status, "COMPLETE");
  assert.equal(state.results.length, 1);
  assert.equal(state.tasks[0].workerKind, "CALLBACK");
  assert.equal(JSON.parse(await readFile(stateFile, "utf8")).schemaVersion, 2);
});

test("native receipt callback is durable without replaying completed work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-coordinator-native-"));
  const calls = [];
  const worker = async (task, context) => {
    calls.push(task.taskId);
    await context.recordNative({ requestId: "orca-request-1", terminal: "term_fixture", stages: ["input_accepted", "turn_started"] });
    const artifactPath = path.join(context.stateRoot, task.artifactPath);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, JSON.stringify({ rehearsal: true, nativeResume: true }));
    return { status: "COMPLETED", artifactPath, workerStatus: "NATIVE_RESUME_VERIFIED", native: { marker: "NATIVE-MARKER" } };
  };
  const stateFile = path.join(root, "state.json");
  const coordinator = new ProjectCoordinator({ stateFile, worker });
  await coordinator.init();
  await coordinator.registerTask({ taskId: "native", owner: "session-c", scope: "native", replaySafe: true, workerKind: "ORCA_NATIVE", native: { handle: "term_fixture" } });
  await coordinator.waitFor("native");
  const restarted = new ProjectCoordinator({ stateFile, worker });
  await restarted.init();
  await restarted.runOnce();
  assert.deepEqual(calls, ["native"]);
  assert.equal(restarted.snapshot().results[0].native.requestId, "orca-request-1");
  assert.equal(restarted.snapshot().results[0].native.marker, "NATIVE-MARKER");
});

test("native state strips raw terminal output and marks reconciliation complete", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-coordinator-native-scrub-"));
  const stateFile = path.join(root, "state.json");
  const worker = async (task, context) => {
    await context.recordNative({ requestId: "orca-request-scrub", outputExcerpt: "private prompt output" });
    const artifactPath = path.join(context.stateRoot, task.artifactPath);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, JSON.stringify({ rehearsal: true, liveEligible: false, externalSideEffects: false, unknownRetryAllowed: false }));
    return { status: "COMPLETED", artifactPath, workerStatus: "NATIVE_RESUME_VERIFIED", native: { marker: "SCRUB-MARKER", outputExcerpt: "more private output" } };
  };
  const coordinator = new ProjectCoordinator({ stateFile, worker });
  await coordinator.init();
  await coordinator.registerTask({ taskId: "native-scrub", owner: "session-c", scope: "native", replaySafe: true, workerKind: "ORCA_NATIVE", native: { terminal: "term_fixture" } });
  await coordinator.waitFor("native-scrub");
  const persisted = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(persisted.tasks[0].native.outputExcerpt, undefined);
  assert.equal(persisted.results[0].native.outputExcerpt, undefined);
  assert.equal(persisted.tasks[0].native.reconciliation, "COMPLETED");
  assert.equal(persisted.results[0].native.reconciliation, "COMPLETED");
  assert.equal(persisted.tasks[0].wakeState, "NATIVE_COMPLETED");
});
