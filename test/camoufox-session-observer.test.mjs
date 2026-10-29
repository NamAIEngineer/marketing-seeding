import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { observeCamoufoxSessionMetadata, normalizeMetadata, persistCamoufoxSessionMetadata } from "../src/camoufox-session-observer.mjs";

test("Camoufox session observer projects sanitized READY identity metadata", () => {
  const result = normalizeMetadata({
    schemaVersion: 1,
    provider: "camoufox",
    platform: "linkedin",
    accountId: "linkedin_primary",
    profileReference: "linkedin:linkedin_primary",
    status: "READY",
    authState: "READY",
    identityStatus: "VERIFIED",
    observedAt: "2026-10-27T08:26:00.000Z",
    verifiedIdentity: { displayName: "Nam Phạm Phương", profileUrl: "https://www.linkedin.com/in/nam-ph%E1%BA%A1m-ph%C6%B0%C6%A1ng-b48897278/" }
  });
  assert.equal(result.state, "OBSERVED");
  assert.equal(result.sessions[0].state, "READY");
  assert.equal(result.sessions[0].identityStatus, "VERIFIED");
  assert.match(result.sessions[0].profileFingerprint, /^sha256:/);
  assert.equal("password" in result.sessions[0], false);
});
test("Camoufox session observer rejects secret-like metadata", () => {
  assert.throws(() => normalizeMetadata({ provider: "camoufox", password: "redacted" }), { code: "CAMOUFOX_SESSION_METADATA_SECRET_FIELD" });
});

test("Camoufox session observer reads protected metadata without mutating it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "camoufox-session-observer-"));
  const file = path.join(root, "session.json");
  await writeFile(file, JSON.stringify({ provider: "camoufox", platform: "linkedin", accountId: "a", profileReference: "p", status: "READY", authState: "READY", identityStatus: "VERIFIED", verifiedIdentity: { profileUrl: "https://www.linkedin.com/in/a" }, observedAt: "2026-10-27T08:26:00.000Z" }));
  const result = await observeCamoufoxSessionMetadata(file, { now: new Date("2026-10-27T08:27:00.000Z") });
  assert.equal(result.state, "OBSERVED");
  assert.equal(result.sessions[0].accountId, "a");
});

test("Camoufox session observer marks expired metadata stale", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "camoufox-session-observer-expired-"));
  const file = path.join(root, "session.json");
  await writeFile(file, JSON.stringify({
    provider: "camoufox",
    platform: "linkedin",
    accountId: "a",
    profileReference: "p",
    status: "READY",
    authState: "READY",
    identityStatus: "VERIFIED",
    verifiedIdentity: { profileUrl: "https://www.linkedin.com/in/a" },
    observedAt: "2026-10-27T08:26:00.000Z",
    expiresAt: "2026-10-27T08:31:00.000Z"
  }));
  const result = await observeCamoufoxSessionMetadata(file, { now: new Date("2026-10-27T08:32:00.000Z") });
  assert.equal(result.state, "STALE");
  assert.equal(result.code, "CAMOUFOX_SESSION_METADATA_EXPIRED");
  assert.equal(result.sessions[0].state, "STALE");
  assert.equal(result.sessions[0].freshness, "EXPIRED");
});

test("Camoufox session observer persists only sanitized metadata atomically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "camoufox-session-observer-persist-"));
  const file = path.join(root, "nested", "session.json");
  const result = await persistCamoufoxSessionMetadata(file, {
    provider: "camoufox", platform: "linkedin", accountId: "a", profileReference: "p",
    identityReference: "https://www.linkedin.com/in/a", status: "READY", authState: "READY", identityStatus: "VERIFIED",
    content: "must-not-persist"
  }, { now: new Date("2026-10-27T08:27:00.000Z") });
  assert.equal(result.state, "OBSERVED");
  const stored = JSON.parse(await readFile(file, "utf8"));
  assert.equal(stored.accountId, "a");
  assert.equal(stored.status, "READY");
  assert.equal("content" in stored, false);
  assert.equal("sessions" in stored, false);
  const observed = await observeCamoufoxSessionMetadata(file, { now: new Date("2026-10-27T08:28:00.000Z") });
  assert.equal(observed.state, "OBSERVED");
  assert.equal(observed.sessions[0].identityStatus, "VERIFIED");
  assert.deepEqual((await readdir(path.dirname(file))).filter((item) => item.startsWith(".session.json.")), []);
});

test("Camoufox session observer rejects secret-like values before persistence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "camoufox-session-observer-secret-"));
  await assert.rejects(() => persistCamoufoxSessionMetadata(path.join(root, "session.json"), {
    provider: "camoufox", platform: "linkedin", accountId: "a", profileReference: "p",
    identityReference: "https://www.linkedin.com/in/a", status: "READY", authState: "READY", identityStatus: "VERIFIED",
    accessToken: "redacted"
  }), { code: "CAMOUFOX_SESSION_METADATA_SECRET_FIELD" });
});
