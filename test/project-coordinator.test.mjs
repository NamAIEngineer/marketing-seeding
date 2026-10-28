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
  assert.equal(state.schemaVersion, 3);
  assert.equal(state.tasks[0].status, "COMPLETE");
  assert.equal(state.results.length, 1);
  assert.equal(state.tasks[0].workerKind, "CALLBACK");
  assert.equal(JSON.parse(await readFile(stateFile, "utf8")).schemaVersion, 3);
});

test("native WAITING_CHATGPT recovery backs off, preserves the exact request, and blocks after a durable limit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-coordinator-native-limit-"));
  const calls = [];
  const worker = async (task) => {
    calls.push({ attemptId: task.attemptId, requestId: task.native?.requestId });
    return { status: "WAITING_CHATGPT", native: { requestId: task.native.requestId, reconciliation: "WAITING_CHATGPT" } };
  };
  const stateFile = path.join(root, "state.json");
  const coordinator = new ProjectCoordinator({ stateFile, worker, intervalMs: 25 });
  await coordinator.init();
  await coordinator.registerTask({
    taskId: "native-limit",
    owner: "session-c",
    scope: "native-recovery",
    replaySafe: true,
    workerKind: "ORCA_NATIVE",
    native: { requestId: "request-fixed", terminal: "term_fixture", prompt: "safe" }
  });

  assert.equal((await coordinator.runOnce()).status, "IDLE");
  let persisted = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(persisted.tasks[0].status, "WAITING_CHATGPT");
  assert.equal(persisted.tasks[0].nativeRecovery.attempts, 0);
  assert.match(persisted.tasks[0].nativeRecovery.nextAttemptAt, /^20/);

  for (let i = 0; i < 3; i += 1) {
    persisted = JSON.parse(await readFile(stateFile, "utf8"));
    persisted.tasks[0].nativeRecovery.nextAttemptAt = "2000-01-01T00:00:00.000Z";
    await writeFile(stateFile, JSON.stringify(persisted));
    await coordinator.runOnce();
  }

  persisted = JSON.parse(await readFile(stateFile, "utf8"));
  persisted.tasks[0].nativeRecovery.nextAttemptAt = "2000-01-01T00:00:00.000Z";
  await writeFile(stateFile, JSON.stringify(persisted));
  await coordinator.runOnce();

  const task = coordinator.snapshot().tasks[0];
  assert.equal(task.status, "BLOCKED_HUMAN_INPUT");
  assert.equal(task.error, "COORDINATOR_NATIVE_RECOVERY_LIMIT_REACHED");
  assert.equal(task.native.reconciliation, "BLOCKED_RETRY_LIMIT");
  assert.equal(task.native.requestId, "request-fixed");
  assert.equal(task.nativeRecovery.attempts, 3);
  assert.equal(calls.length, 4);
  assert.deepEqual([...new Set(calls.map((call) => call.requestId))], ["request-fixed"]);
  assert.ok(coordinator.snapshot().wakeEvents.some((event) => event.type === "NATIVE_RECOVERY_BLOCKED"));
});

test("native WAITING_CHATGPT without a request ID fails closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-coordinator-native-no-request-"));
  const coordinator = new ProjectCoordinator({
    stateFile: path.join(root, "state.json"),
    worker: async () => ({ status: "WAITING_CHATGPT", native: { terminal: "term_fixture" } })
  });
  await coordinator.init();
  await coordinator.registerTask({
    taskId: "native-missing-request",
    owner: "session-c",
    scope: "native-recovery",
    replaySafe: true,
    workerKind: "ORCA_NATIVE",
    native: { terminal: "term_fixture" }
  });
  await coordinator.runOnce();
  const persisted = JSON.parse(await readFile(coordinator.stateFile, "utf8"));
  const recovered = persisted.tasks.find((item) => item.taskId === "native-missing-request");
  assert.equal(recovered.status, "BLOCKED_HUMAN_INPUT");
  assert.equal(recovered.error, "COORDINATOR_NATIVE_RECOVERY_REQUIRES_REQUEST_ID");
});

test("restart consumes an interrupted native recovery lease instead of replaying it indefinitely", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-coordinator-native-crash-"));
  const stateFile = path.join(root, "state.json");
  const worker = async () => ({ status: "WAITING_CHATGPT", native: { requestId: "request-crash-safe" } });
  const seed = new ProjectCoordinator({ stateFile, worker });
  await seed.init();
  await seed.registerTask({
    taskId: "native-crash-safe",
    owner: "session-c",
    scope: "native-recovery",
    replaySafe: true,
    workerKind: "ORCA_NATIVE",
    native: { requestId: "request-crash-safe", terminal: "term_fixture", prompt: "safe" }
  });

  for (let interruptedAttempt = 1; interruptedAttempt <= 3; interruptedAttempt += 1) {
    const persisted = JSON.parse(await readFile(stateFile, "utf8"));
    const task = persisted.tasks[0];
    task.status = "WAITING_CHATGPT";
    task.nativeRecovery = {
      ...task.nativeRecovery,
      attempts: interruptedAttempt - 1,
      inFlightAttempt: interruptedAttempt,
      inFlightSince: new Date().toISOString(),
      nextAttemptAt: null
    };
    await writeFile(stateFile, JSON.stringify(persisted));
    const restarted = new ProjectCoordinator({ stateFile, worker });
    const state = await restarted.init();
    const recovered = state.tasks[0];
    assert.equal(recovered.nativeRecovery.attempts, interruptedAttempt);
    assert.equal(recovered.nativeRecovery.inFlightAttempt, null);
    if (interruptedAttempt < 3) {
      assert.equal(recovered.status, "WAITING_CHATGPT");
      assert.ok(Date.parse(recovered.nativeRecovery.nextAttemptAt) > Date.now());
    } else {
      assert.equal(recovered.status, "BLOCKED_HUMAN_INPUT");
      assert.equal(recovered.error, "COORDINATOR_NATIVE_RECOVERY_LIMIT_REACHED");
    }
  }
});

test("malformed native recovery timestamp fails closed on restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-coordinator-native-time-"));
  const stateFile = path.join(root, "state.json");
  const coordinator = new ProjectCoordinator({ stateFile, worker: async () => ({ status: "WAITING_CHATGPT", native: { requestId: "request-time-safe" } }) });
  await coordinator.init();
  await coordinator.registerTask({
    taskId: "native-invalid-time",
    owner: "session-c",
    scope: "native-recovery",
    replaySafe: true,
    workerKind: "ORCA_NATIVE",
    native: { requestId: "request-time-safe", terminal: "term_fixture", prompt: "safe" }
  });
  const persisted = JSON.parse(await readFile(stateFile, "utf8"));
  persisted.tasks[0].status = "WAITING_CHATGPT";
  persisted.tasks[0].nativeRecovery.nextAttemptAt = "not-a-date";
  await writeFile(stateFile, JSON.stringify(persisted));
  const restarted = new ProjectCoordinator({ stateFile, worker: coordinator.worker });
  await restarted.init();
  const task = restarted.snapshot().tasks[0];
  assert.equal(task.status, "BLOCKED_HUMAN_INPUT");
  assert.equal(task.error, "COORDINATOR_NATIVE_RECOVERY_TIMESTAMP_INVALID");
});

test("manual native recovery clears a malformed timestamp fence before retrying the exact request", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-coordinator-native-manual-recovery-"));
  const stateFile = path.join(root, "state.json");
  const calls = [];
  const worker = async (task) => {
    calls.push(task.native.requestId);
    return { status: "WAITING_CHATGPT", native: { requestId: task.native.requestId } };
  };
  const coordinator = new ProjectCoordinator({ stateFile, worker, intervalMs: 25 });
  await coordinator.init();
  await coordinator.registerTask({
    taskId: "native-manual-recovery",
    owner: "session-c",
    scope: "native-recovery",
    replaySafe: true,
    workerKind: "ORCA_NATIVE",
    native: { requestId: "request-manual-safe", terminal: "term_fixture", prompt: "safe" }
  });
  await coordinator.runOnce();
  const persisted = JSON.parse(await readFile(stateFile, "utf8"));
  persisted.tasks[0].status = "WAITING_CHATGPT";
  persisted.tasks[0].nativeRecovery.nextAttemptAt = "not-a-date";
  await writeFile(stateFile, JSON.stringify(persisted));
  const restarted = new ProjectCoordinator({ stateFile, worker });
  await restarted.init();
  assert.equal(restarted.snapshot().tasks[0].status, "BLOCKED_HUMAN_INPUT");
  await restarted.recoverTask({ taskId: "native-manual-recovery", reason: "operator reconciles malformed local metadata" });
  const recovered = restarted.snapshot().tasks[0];
  assert.equal(recovered.nativeRecovery.invalidNextAttemptAt, false);
  assert.equal(recovered.nativeRecovery.manualRecoveryCount, 1);
  assert.equal(recovered.native.requestId, "request-manual-safe");
  await restarted.runOnce();
  assert.deepEqual(calls, ["request-manual-safe", "request-manual-safe"]);
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

test("acceptance evidence controls dependency release and schedules the next task once", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-coordinator-acceptance-next-"));
  const calls = [];
  const worker = async (task, context) => {
    calls.push(task.taskId);
    const artifactPath = path.join(context.stateRoot, task.artifactPath);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, JSON.stringify({ taskId: task.taskId, rehearsal: true }));
    return task.taskId === "first"
      ? {
        status: "COMPLETED",
        artifactPath,
        workerStatus: "EXECUTED",
        acceptance: {
          status: "PASSED",
          sourceRevision: "rev-1",
          checks: [{ id: "artifact", status: "PASSED", evidenceRefs: ["artifact:first"] }],
          evidenceRefs: ["artifact:first"]
        }
      }
      : { status: "COMPLETED", artifactPath, workerStatus: "EXECUTED" };
  };
  const stateFile = path.join(root, "state.json");
  const coordinator = new ProjectCoordinator({ stateFile, worker, intervalMs: 25 });
  await coordinator.init();
  await coordinator.registerTask({
    taskId: "first",
    owner: "session-c",
    scope: "acceptance",
    replaySafe: true,
    acceptance: { version: 1, sourceRevision: "rev-1", checks: [{ id: "artifact" }], evidenceRefs: ["artifact:first"] },
    nextTasks: [{ taskId: "second", owner: "session-c", scope: "acceptance", replaySafe: true }]
  });
  const first = await coordinator.waitFor("first");
  const second = await coordinator.waitFor("second");
  assert.equal(first.status, "COMPLETE");
  assert.equal(first.acceptanceStatus, "PASSED");
  assert.equal(second.status, "COMPLETE");
  assert.deepEqual(calls, ["first", "second"]);
  const state = coordinator.snapshot();
  assert.deepEqual(state.tasks.find((task) => task.taskId === "second").dependsOn, ["first"]);
  assert.equal(state.results.length, 2);
  assert.equal(state.results[0].acceptanceStatus, "PASSED");
  const restarted = new ProjectCoordinator({ stateFile, worker, intervalMs: 25 });
  await restarted.init();
  await restarted.runOnce();
  assert.deepEqual(calls, ["first", "second"]);
  assert.equal(restarted.snapshot().tasks.filter((task) => task.taskId === "second").length, 1);
});

test("failed acceptance is recorded separately and dispatches a bounded repair task", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-coordinator-acceptance-repair-"));
  const calls = [];
  const worker = async (task, context) => {
    calls.push(task.taskId);
    const artifactPath = path.join(context.stateRoot, task.artifactPath);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, JSON.stringify({ taskId: task.taskId, rehearsal: true }));
    return task.taskId === "check"
      ? { status: "COMPLETED", artifactPath, workerStatus: "EXECUTED", acceptance: { status: "FAILED", checks: [{ id: "clean", status: "FAILED", detail: "dirty" }], reason: "CHECK_FAILED" } }
      : { status: "COMPLETED", artifactPath, workerStatus: "EXECUTED" };
  };
  const stateFile = path.join(root, "state.json");
  const coordinator = new ProjectCoordinator({ stateFile, worker, intervalMs: 25 });
  await coordinator.init();
  await coordinator.registerTask({
    taskId: "check",
    owner: "session-c",
    scope: "acceptance",
    replaySafe: true,
    acceptance: { version: 1, checks: [{ id: "clean" }] },
    repairTasks: [{ taskId: "repair", owner: "session-c", scope: "acceptance-repair", replaySafe: true }]
  });
  const check = await coordinator.waitFor("check");
  const repair = await coordinator.waitFor("repair");
  assert.equal(check.status, "COMPLETE");
  assert.equal(check.acceptanceStatus, "FAILED");
  assert.equal(check.error, "CHECK_FAILED");
  assert.equal(repair.status, "COMPLETE");
  assert.deepEqual(calls, ["check", "repair"]);
  assert.equal(coordinator.snapshot().results[0].acceptanceStatus, "FAILED");
  const restarted = new ProjectCoordinator({ stateFile, worker, intervalMs: 25 });
  await restarted.init();
  await restarted.runOnce();
  assert.deepEqual(calls, ["check", "repair"]);
  assert.equal(restarted.snapshot().tasks.filter((task) => task.taskId === "repair").length, 1);
});

test("acceptance evidence cannot release a dependency when source revision or evidence differs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-coordinator-acceptance-fence-"));
  const worker = async (task, context) => {
    const artifactPath = path.join(context.stateRoot, task.artifactPath);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, JSON.stringify({ rehearsal: true }));
    return { status: "COMPLETED", artifactPath, acceptance: { status: "PASSED", sourceRevision: "wrong", evidenceRefs: ["wrong"] } };
  };
  const coordinator = new ProjectCoordinator({ stateFile: path.join(root, "state.json"), worker, intervalMs: 25 });
  await coordinator.init();
  await coordinator.registerTask({
    taskId: "fenced",
    owner: "session-c",
    scope: "acceptance",
    replaySafe: true,
    acceptance: { sourceRevision: "expected", evidenceRefs: ["evidence:expected"], checks: [] }
  });
  const task = await coordinator.waitFor("fenced");
  assert.equal(task.status, "COMPLETE");
  assert.equal(task.acceptanceStatus, "FAILED");
  assert.equal(task.lastAcceptance.reason, "COORDINATOR_ACCEPTANCE_SOURCE_REVISION_MISMATCH");
  assert.equal(coordinator.snapshot().results[0].acceptanceStatus, "FAILED");
});
