import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runOrcaNativeFollowUp } from "../src/orca-native-session.mjs";

test("native follow-up persists request, waits for completion, and accepts agent-created artifact", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-native-session-"));
  const marker = "NATIVE-SESSION-TEST-MARKER";
  const artifactPath = path.join(root, "artifacts", "result.json");
  const calls = [];
  let readCount = 0;
  const runCommand = async (_orca, args) => {
    calls.push(args);
    if (args[0] === "terminal" && args[1] === "read") {
      readCount += 1;
      return { terminal: { status: "running", tail: readCount === 1 ? [] : [marker] } };
    }
    if (args[0] === "terminal" && args[1] === "send") {
      await mkdir(path.dirname(artifactPath), { recursive: true });
      await writeFile(artifactPath, JSON.stringify({ rehearsal: true, liveEligible: false, externalSideEffects: false, unknownRetryAllowed: false }));
      return { send: { accepted: true, prompt: { requestId: "request-test-1", processIncarnation: "incarnation-test", stages: ["input_accepted", "turn_started"], observation: "supported" } }, mutation: { replayed: false } };
    }
    if (args[0] === "terminal" && args[1] === "wait") return { wait: { condition: "tui-idle", satisfied: true, status: "running" } };
    throw new Error(`unexpected command ${args.join(" ")}`);
  };
  const result = await runOrcaNativeFollowUp({
    terminal: "term_test-native-1",
    prompt: "safe native test",
    marker,
    stateRoot: root,
    artifactPath: "artifacts/result.json",
    runCommand,
    recordNative: async () => undefined
  });
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.workerStatus, "NATIVE_RESUME_VERIFIED");
  assert.equal(result.native.requestId, "request-test-1");
  assert.equal(result.native.artifactCreatedBySession, true);
  assert.equal(result.native.outputExcerpt, undefined);
  assert.equal((await readFile(artifactPath, "utf8")), JSON.stringify({ rehearsal: true, liveEligible: false, externalSideEffects: false, unknownRetryAllowed: false }));
  assert.equal(calls.filter((args) => args[1] === "send").length, 1);
});

test("native follow-up refuses a stale marker and never writes a fabricated artifact", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-native-session-stale-"));
  const marker = "STALE-MARKER";
  const runCommand = async (_orca, args) => {
    if (args[0] === "terminal" && args[1] === "read") return { terminal: { status: "running", tail: [marker] } };
    if (args[0] === "terminal" && args[1] === "send") return { send: { accepted: true, prompt: { requestId: "request-test-2", processIncarnation: "incarnation-test", stages: ["input_accepted"], observation: "supported" } }, mutation: { replayed: false } };
    if (args[0] === "terminal" && args[1] === "wait") return { wait: { condition: "tui-idle", satisfied: true, status: "running" } };
    throw new Error("unexpected command");
  };
  await assert.rejects(() => runOrcaNativeFollowUp({ terminal: "term_test-native-2", prompt: "safe", marker, stateRoot: root, artifactPath: "artifacts/result.json", runCommand }), /ORCA_NATIVE_MARKER_NOT_FRESH/);
});

test("native recovery rejects an old marker when exact replay is not confirmed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-native-session-recovery-stale-"));
  const marker = "RECOVERY-STALE-MARKER";
  const calls = [];
  const runCommand = async (_orca, args) => {
    calls.push(args);
    if (args[0] === "terminal" && args[1] === "read") return { terminal: { status: "running", latestCursor: "7", tail: [marker] } };
    if (args[0] === "terminal" && args[1] === "send") return { send: { accepted: true, prompt: { requestId: "request-recovery-stale", processIncarnation: "incarnation-test", stages: ["input_accepted"], observation: "supported" } }, mutation: { replayed: false } };
    if (args[0] === "terminal" && args[1] === "wait") return { wait: { condition: "tui-idle", satisfied: true, status: "running" } };
    throw new Error("unexpected command");
  };
  await assert.rejects(() => runOrcaNativeFollowUp({ terminal: "term_test-native-3", prompt: "safe recovery", marker, nativeRequestId: "request-recovery-stale", stateRoot: root, artifactPath: "artifacts/result.json", runCommand }), /ORCA_NATIVE_MARKER_NOT_FRESH/);
  assert.equal(calls.filter((args) => args[1] === "send").length, 1);
  assert.equal(calls.some((args) => args.includes("--retry-request") && args.includes("request-recovery-stale")), true);
});

test("native recovery rejects a malformed persisted request ID without sending a fresh prompt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-native-session-recovery-invalid-"));
  const calls = [];
  const runCommand = async (_orca, args) => {
    calls.push(args);
    if (args[0] === "terminal" && args[1] === "read") return { terminal: { status: "running", tail: [] } };
    throw new Error("unexpected command");
  };
  await assert.rejects(() => runOrcaNativeFollowUp({
    terminal: "term_test-native-invalid", prompt: "safe recovery", marker: "INVALID-ID-MARKER",
    nativeRequestId: "malformed request id", stateRoot: root, artifactPath: "artifacts/result.json", runCommand
  }), /ORCA_NATIVE_REQUEST_ID_INVALID/);
  assert.equal(calls.filter((args) => args[1] === "send").length, 0);
});

test("native recovery accepts a fresh turn receipt when terminal cursor is unavailable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-native-session-recovery-fresh-"));
  const marker = "RECOVERY-FRESH-MARKER";
  const artifactPath = path.join(root, "artifacts", "result.json");
  const runCommand = async (_orca, args) => {
    if (args[0] === "terminal" && args[1] === "read") return { terminal: { status: "running", tail: [marker] } };
    if (args[0] === "terminal" && args[1] === "send") {
      await mkdir(path.dirname(artifactPath), { recursive: true });
      await writeFile(artifactPath, JSON.stringify({ rehearsal: true, liveEligible: false, externalSideEffects: false, unknownRetryAllowed: false }));
      return { send: { accepted: true, prompt: { requestId: "request-recovery-fresh", processIncarnation: "incarnation-test", stages: ["input_accepted", "turn_started"], observation: "supported" } }, mutation: { replayed: false } };
    }
    if (args[0] === "terminal" && args[1] === "wait") return { wait: { condition: "tui-idle", satisfied: true, status: "running" } };
    throw new Error("unexpected command");
  };
  const result = await runOrcaNativeFollowUp({ terminal: "term_test-native-4", prompt: "safe recovery", marker, nativeRequestId: "request-recovery-fresh", stateRoot: root, artifactPath: "artifacts/result.json", runCommand });
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.native.turnStartedObserved, true);
});
