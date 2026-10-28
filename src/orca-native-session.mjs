import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

const execFile = promisify(execFileCallback);
const DEFAULT_ORCA = "/usr/local/bin/orca";
const SAFE_HANDLE = /^term_[A-Za-z0-9-]{8,128}$/;
const SAFE_REQUEST = /^[A-Za-z0-9-]{8,128}$/;
function bounded(value, max = 4_000) {
  return String(value || "").replace(/(password|passphrase|secret|token|cookie|credential|api[_-]?key|bearer)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]").slice(-max);
}

function requiredString(value, label, pattern = null) {
  const result = String(value || "").trim();
  if (!result) throw new Error(`${label} is required`);
  if (pattern && !pattern.test(result)) throw new Error(`${label} is invalid`);
  return result;
}

async function orcaJson(orcaPath, args, timeoutMs, runCommand = null) {
  if (runCommand) {
    const result = await runCommand(orcaPath, [...args, "--json"], timeoutMs);
    if (!result || typeof result !== "object") throw new Error("ORCA_NATIVE_INVALID_RESULT");
    return result.result && result.ok === true ? result.result : result;
  }
  let result;
  try {
    result = await execFile(orcaPath, [...args, "--json"], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 256 * 1024,
      windowsHide: true
    });
  } catch (error) {
    const detail = bounded(error?.stderr || error?.stdout || error?.message || error);
    throw new Error(`ORCA_NATIVE_COMMAND_FAILED:${detail}`);
  }
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { throw new Error("ORCA_NATIVE_INVALID_JSON"); }
  if (!parsed || parsed.ok !== true) throw new Error(`ORCA_NATIVE_REFUSED:${bounded(parsed?.error?.code || parsed?.error?.message || "unknown")}`);
  return parsed.result;
}

export async function inspectOrcaNativeFollowUp({ terminal, requestId, orcaPath = process.env.ORCA_BIN || DEFAULT_ORCA, timeoutMs = 15_000, runCommand = null } = {}) {
  const handle = requiredString(terminal, "native terminal", SAFE_HANDLE);
  const request = requiredString(requestId, "Orca requestId", SAFE_REQUEST);
  const read = await orcaJson(orcaPath, ["terminal", "read", "--terminal", handle], timeoutMs, runCommand);
  return { terminal: handle, requestId: request, output: readTail(read), status: read?.terminal?.status || null };
}

function readTail(readResult) {
  const tail = readResult?.terminal?.tail;
  return Array.isArray(tail) ? tail.map((line) => String(line)).join("\n") : "";
}

function readCursor(readResult) {
  const terminal = readResult?.terminal;
  const value = terminal?.latestCursor ?? terminal?.cursor ?? terminal?.nextCursor;
  return value === undefined || value === null ? null : String(value);
}

function nativeSummary({ requestId, handle, processIncarnation, stages, observation, marker, output, wait, replayed, markerFresh }) {
  return {
    protocol: "orca-cli-terminal-send.v1",
    requestId,
    terminal: handle,
    processIncarnation: processIncarnation || null,
    stages: Array.isArray(stages) ? stages.slice(0, 8) : [],
    observation: observation || null,
    marker,
    // Keep only a digest. Terminal output can contain private task data.
    outputHash: createHash("sha256").update(String(output || "")).digest("hex"),
    replayed: replayed === true,
    markerFresh: markerFresh === true,
    wait: wait ? {
      condition: wait.condition || null,
      satisfied: wait.satisfied === true,
      status: wait.status || null
    } : null
  };
}

/**
 * Send one exact, idempotent follow-up to a live Orca terminal.
 *
 * The caller must provide a runtime-issued terminal handle and a unique
 * response marker. A receipt without turn_started or a marker in the fresh
 * terminal output is never reported as completion. Retry uses Orca's exact
 * request ID; this function never submits a fresh prompt after ambiguity.
 */
export async function runOrcaNativeFollowUp({
  terminal,
  prompt,
  marker,
  artifactPath,
  stateRoot,
  orcaPath = process.env.ORCA_BIN || DEFAULT_ORCA,
  submitTimeoutMs = 30_000,
  completionTimeoutMs = 120_000,
  recordNative = async () => undefined,
  runCommand = null,
  nativeRequestId = null
} = {}) {
  const handle = requiredString(terminal, "native terminal", SAFE_HANDLE);
  const text = requiredString(prompt, "native prompt");
  const expectedMarker = requiredString(marker, "native marker");
  const root = requiredString(stateRoot, "native stateRoot");
  const relativeArtifact = requiredString(artifactPath, "native artifactPath");
  const before = await orcaJson(orcaPath, ["terminal", "read", "--terminal", handle], 15_000, runCommand);
  const baselineOutput = readTail(before);
  const baselineCursor = readCursor(before);
  const priorRequestId = SAFE_REQUEST.test(String(nativeRequestId || "")) ? String(nativeRequestId) : null;
  const initial = priorRequestId
    ? await orcaJson(orcaPath, ["terminal", "send", "--terminal", handle, "--text", text, "--enter", "--retry-request", priorRequestId, "--wait-submit", String(Math.ceil(submitTimeoutMs / 1000))], submitTimeoutMs + 10_000, runCommand)
    : await orcaJson(orcaPath, ["terminal", "send", "--terminal", handle, "--text", text, "--enter", "--wait-submit", String(Math.ceil(submitTimeoutMs / 1000))], submitTimeoutMs + 10_000, runCommand);
  const promptReceipt = initial?.send?.prompt;
  const requestId = requiredString(promptReceipt?.requestId || priorRequestId, "Orca requestId", SAFE_REQUEST);
  const processIncarnation = promptReceipt?.processIncarnation || null;
  if (!priorRequestId) await recordNative({ requestId, terminal: handle, processIncarnation, accepted: initial?.send?.accepted === true, stages: promptReceipt?.stages || [], observation: promptReceipt?.observation || null });
  let settled = initial;
  if (!priorRequestId && (!Array.isArray(promptReceipt?.stages) || !promptReceipt.stages.includes("turn_started"))) {
    settled = await orcaJson(orcaPath, ["terminal", "send", "--terminal", handle, "--text", text, "--enter", "--retry-request", requestId, "--wait-submit", String(Math.ceil(submitTimeoutMs / 1000))], submitTimeoutMs + 10_000, runCommand);
    const replayReceipt = settled?.send?.prompt;
    if (replayReceipt?.requestId !== requestId) throw new Error("ORCA_NATIVE_REQUEST_ID_MISMATCH");
    await recordNative({ requestId, replayed: settled?.mutation?.replayed === true, stages: replayReceipt?.stages || [], observation: replayReceipt?.observation || null });
  }
  const wait = await orcaJson(orcaPath, ["terminal", "wait", "--terminal", handle, "--for", "tui-idle", "--timeout-ms", String(completionTimeoutMs)], completionTimeoutMs + 10_000, runCommand);
  if (wait?.wait?.satisfied !== true) throw new Error("ORCA_NATIVE_TURN_COMPLETION_UNPROVEN");
  const read = await orcaJson(orcaPath, ["terminal", "read", "--terminal", handle], 15_000, runCommand);
  const output = readTail(read);
  const settledPrompt = settled?.send?.prompt || promptReceipt || {};
  const replayed = settled?.mutation?.replayed === true;
  const turnStarted = Array.isArray(settledPrompt.stages) && settledPrompt.stages.includes("turn_started");
  // A recovery may see the old marker. Accept it only with exact replay or a
  // fresh turn receipt; marker text alone is insufficient evidence.
  const currentCursor = readCursor(read);
  const cursorAdvanced = baselineCursor !== null && currentCursor !== null && baselineCursor !== currentCursor;
  const markerFresh = output.includes(expectedMarker) &&
    (!baselineOutput.includes(expectedMarker) || replayed || turnStarted || cursorAdvanced);
  if (!markerFresh) throw new Error("ORCA_NATIVE_MARKER_NOT_FRESH");
  const native = nativeSummary({
    requestId,
    handle,
    processIncarnation,
    stages: settledPrompt.stages || [],
    observation: settledPrompt.observation || null,
    marker: expectedMarker,
    output,
    wait: wait?.wait,
    replayed,
    markerFresh
  });
  native.turnStartedObserved = turnStarted;
  native.freshTerminalOutputObserved = cursorAdvanced;
  native.completedAt = new Date().toISOString();
  const destination = path.resolve(root, relativeArtifact);
  if (destination !== path.resolve(root) && !destination.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error("native artifact escapes state root");
  let artifactBytes;
  try { artifactBytes = await readFile(destination); } catch { throw new Error("ORCA_NATIVE_ARTIFACT_NOT_CREATED_BY_SESSION"); }
  const rootReal = await realpath(root);
  const artifactReal = await realpath(destination);
  if (artifactReal !== rootReal && !artifactReal.startsWith(`${rootReal}${path.sep}`)) throw new Error("native artifact symlink escapes state root");
  let artifact;
  try { artifact = JSON.parse(artifactBytes.toString("utf8")); } catch { throw new Error("ORCA_NATIVE_ARTIFACT_INVALID_JSON"); }
  if (!artifact || artifact.rehearsal !== true || artifact.liveEligible !== false || artifact.externalSideEffects !== false || artifact.unknownRetryAllowed !== false) throw new Error("ORCA_NATIVE_ARTIFACT_CONTRACT_FAILED");
  native.artifactCreatedBySession = true;
  native.artifactHash = createHash("sha256").update(artifactBytes).digest("hex");
  return { status: "COMPLETED", artifactPath: destination, workerStatus: "NATIVE_RESUME_VERIFIED", native };
}

export { SAFE_HANDLE, SAFE_REQUEST };
