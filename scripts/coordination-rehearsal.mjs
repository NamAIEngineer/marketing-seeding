import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProjectCoordinator } from "../src/project-coordinator.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-coordination-rehearsal-"));
const stateFile = path.join(root, "state.json");
const calls = [];
const worker = async (task, context) => {
  calls.push({ taskId: task.taskId, attemptId: context.attemptId, idempotencyKey: context.idempotencyKey });
  const artifactPath = path.join(context.stateRoot, task.artifactPath);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  try { await readFile(artifactPath); return { status: "COMPLETED", artifactPath, workerStatus: "IDEMPOTENT_REPLAY" }; } catch {}
  await writeFile(artifactPath, JSON.stringify({ taskId: task.taskId, rehearsal: true, liveEligible: false, externalSideEffects: false, unknownRetryAllowed: false }));
  return { status: "COMPLETED", artifactPath, workerStatus: "EXECUTED" };
};

const coordinator = new ProjectCoordinator({ stateFile, worker, intervalMs: 25 });
await coordinator.init();
await coordinator.registerTask({ taskId: "wake-proof", owner: "session-c", scope: "integration-coordination", dependsOn: ["dependency-a"], replaySafe: true });
coordinator.start();
await new Promise((resolve) => setTimeout(resolve, 60));
await coordinator.emitDependency({ eventId: "dependency-a-event", dependencyId: "dependency-a", owner: "session-a", checkpoint: "A-CHECKPOINT-ORCA_MS_OS_ABC_CHATGPT_20261028_MASTER_01", requestId: "coordination-rehearsal" });
const completed = await coordinator.waitFor("wake-proof", { timeoutMs: 10_000 });
coordinator.stop();

const restarted = new ProjectCoordinator({ stateFile, worker, intervalMs: 25 });
await restarted.init();
await restarted.runOnce();
const state = restarted.snapshot();
const evidence = {
  schemaVersion: 1,
  rehearsal: true,
  liveEligible: false,
  externalSideEffects: false,
  unknownRetryAllowed: false,
  stateFileHash: createHash("sha256").update(await readFile(stateFile)).digest("hex"),
  task: { taskId: completed.taskId, finalStatus: completed.status, attemptCount: completed.attemptCount, wakeState: completed.wakeState },
  dependency: { eventId: "dependency-a-event", owner: "session-a", checkpoint: "A-CHECKPOINT-ORCA_MS_OS_ABC_CHATGPT_20261028_MASTER_01" },
  workerInvocations: calls,
  restart: { resultCount: state.results.length, taskStatus: state.tasks.find((item) => item.taskId === "wake-proof")?.status, replayExecuted: calls.length > 1 },
  provenance: { coordinator: "src/project-coordinator.mjs", script: "scripts/coordination-rehearsal.mjs", capturedAt: new Date().toISOString() }
};
const output = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (output) await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
