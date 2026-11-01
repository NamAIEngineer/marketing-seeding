import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { projectCoordinatorState, readCoordinatorProjection } from "../src/project-coordinator-projection.mjs";

test("coordinator dashboard projection keeps goal, session, task and result statuses separate", () => {
  const projection = projectCoordinatorState({
    schemaVersion: 3,
    coordinatorId: "coord-1",
    revision: 4,
    updatedAt: "2026-10-29T00:00:00Z",
    goal: {
      goalId: "goal-1",
      goalRunId: "run-1",
      mode: "GOAL",
      nativeGoalMode: "UNAVAILABLE",
      status: "ACTIVE",
      currentBlockers: ["receiver unknown"],
      wake: { consumer: "launchd", condition: "task result" }
    },
    sessionRegistry: [{ role: "session-d", workspace: "/Users/private/project", terminalHandle: "term_private", tabId: "tab_private", paneKey: "pane_private", handshakeRequestId: "request_private", evidenceRefs: ["private-ref"], receiverState: "UNKNOWN", uiMappingState: "PARTIAL" }],
    tasks: [{ taskId: "task-1", owner: "session-d", status: "COMPLETE", workerStatus: "EXECUTED", acceptanceStatus: "FAILED", attemptCount: 1, artifactPath: "/Users/private/artifact.json", lastAcceptance: { evidenceRefs: ["private-ref"] }, error: "blocked" }],
    results: [{ taskId: "task-1", attemptId: "task-1:attempt:1", status: "COMPLETED", workerStatus: "EXECUTED", acceptanceStatus: "FAILED", artifactPath: "/Users/private/artifact.json", artifactHash: "hash", acceptance: { evidenceRefs: ["private-ref"] } }],
    wakeEvents: [{ type: "TASK_SCHEDULED", taskId: "task-1", at: "2026-10-29T00:00:00Z" }]
  });
  assert.equal(projection.goal.status, "ACTIVE");
    assert.equal(projection.goal.nativeGoalMode, "UNAVAILABLE");
  assert.equal(projection.sessionRegistry[0].receiverState, "UNKNOWN");
  assert.equal(projection.sessionRegistry[0].unknown, false);
  assert.equal("terminalHandle" in projection.sessionRegistry[0], false);
  assert.equal("workspace" in projection.sessionRegistry[0], false);
  assert.equal("evidenceRefs" in projection.sessionRegistry[0], false);
  assert.equal(projection.tasks[0].status, "COMPLETE");
  assert.equal(projection.tasks[0].acceptanceStatus, "FAILED");
  assert.equal(projection.tasks[0].evidenceCount, 1);
  assert.equal("artifactPath" in projection.tasks[0], false);
  assert.equal(projection.results[0].workerStatus, "EXECUTED");
  assert.equal(projection.results[0].evidenceCount, 1);
  assert.equal(JSON.stringify(projection).includes("private"), false);
});

test("coordinator dashboard projection fails closed when state is missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "coordinator-projection-"));
  const projection = await readCoordinatorProjection(path.join(root, "missing.json"));
  assert.deepEqual(projection, { available: false, reason: "COORDINATOR_STATE_MISSING" });
  await writeFile(path.join(root, "invalid.json"), "[]");
  assert.equal((await readCoordinatorProjection(path.join(root, "invalid.json"))).available, false);
});
