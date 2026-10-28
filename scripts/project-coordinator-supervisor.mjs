#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ProjectCoordinator } from "../src/project-coordinator.mjs";
import { runOrcaNativeFollowUp } from "../src/orca-native-session.mjs";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const stateFile = path.resolve(option("--state-file", process.env.SEEDING_COORDINATOR_STATE_FILE || path.join(process.cwd(), ".agentic", "project-coordinator", "state.json")));
const taskFile = option("--task-file", null);
const registerOnly = process.argv.includes("--register-only");
const intervalMs = Number(option("--interval-ms", process.env.SEEDING_COORDINATOR_INTERVAL_MS || 500));
const once = process.argv.includes("--once");
const recoverTaskId = option("--recover-task", null);
const runSeconds = Number(option("--run-seconds", 0));

function isRecoverableNativeError(error) {
  const message = String(error?.message || error || "");
  return message.includes("ORCA_NATIVE_TURN_COMPLETION_UNPROVEN") ||
    (message.includes("ORCA_NATIVE_COMMAND_FAILED") && /timeout/i.test(message));
}

async function worker(task, context) {
  if (task.workerKind !== "ORCA_NATIVE") throw new Error("COORDINATOR_NATIVE_SUPERVISOR_UNSUPPORTED_WORKER_KIND");
  const native = task.native;
  if (!native || typeof native !== "object") throw new Error("COORDINATOR_NATIVE_METADATA_MISSING");
  let nativeRequestId = native.requestId || null;
  const recordNative = async (patch = {}) => {
    if (patch.requestId) nativeRequestId = patch.requestId;
    return context.recordNative(patch);
  };
  try {
    return await runOrcaNativeFollowUp({
      ...native,
      nativeRequestId,
      stateRoot: context.stateRoot,
      artifactPath: task.artifactPath,
      recordNative
    });
  } catch (error) {
    // Orca may time out while the accepted turn continues. Keep the task
    // durable and let the next supervisor tick reconcile the exact request ID;
    // never submit a fresh prompt after a request was accepted.
    if (nativeRequestId && isRecoverableNativeError(error)) {
      await recordNative({ reconciliation: "WAITING_CHATGPT", lastError: String(error?.message || error).slice(0, 240) });
      return { status: "WAITING_CHATGPT", native: { requestId: nativeRequestId } };
    }
    throw error;
  }
}

const coordinator = new ProjectCoordinator({ stateFile, worker, intervalMs });
await coordinator.init();
if (recoverTaskId) await coordinator.recoverTask({ taskId: recoverTaskId, reason: "supervisor startup reconciles exact native request" });
if (taskFile) {
  const requested = JSON.parse(await readFile(path.resolve(taskFile), "utf8"));
  if (!requested || typeof requested !== "object" || Array.isArray(requested)) throw new Error("coordinator task file must contain an object");
  await coordinator.registerTask(requested);
}

if (registerOnly) {
  process.stdout.write(`${JSON.stringify({ supervisor: "PROJECT_COORDINATOR", stateFile, status: "TASK_REGISTERED", snapshot: coordinator.snapshot() }, null, 2)}\n`);
  process.exit(0);
}

let stopping = false;
const stop = () => { stopping = true; coordinator.stop(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

if (once) {
  const result = await coordinator.runOnce();
  process.stdout.write(`${JSON.stringify({ supervisor: "PROJECT_COORDINATOR", stateFile, result, snapshot: coordinator.snapshot() }, null, 2)}\n`);
} else {
  coordinator.start();
  const deadline = runSeconds > 0 ? Date.now() + runSeconds * 1000 : null;
  while (!stopping && (!deadline || Date.now() < deadline)) await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, 250)));
  coordinator.stop();
  process.stdout.write(`${JSON.stringify({ supervisor: "PROJECT_COORDINATOR", stateFile, status: "STOPPED", snapshot: coordinator.snapshot() }, null, 2)}\n`);
}
