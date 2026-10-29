import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAuthorizedLocalShutdown, isLoopbackAddress, runtimeMetadata } from "../src/service-lifecycle.mjs";
import { JsonStore } from "../src/store.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHealth(baseUrl, child, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Fixture service exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Fixture service did not become healthy before timeout");
}

function waitForExit(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve({ code: child.exitCode, signal: child.signalCode });
    const timer = setTimeout(() => reject(new Error("Fixture service did not exit after graceful shutdown")), timeoutMs);
    child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}

test("local shutdown authorization accepts only loopback callers with the control token", () => {
  const token = randomBytes(32).toString("hex");
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.0.2.5"), false);
  assert.equal(isAuthorizedLocalShutdown({ remoteAddress: "127.0.0.1", authorization: `Bearer ${token}`, expectedToken: token }), true);
  assert.equal(isAuthorizedLocalShutdown({ remoteAddress: "192.0.2.5", authorization: `Bearer ${token}`, expectedToken: token }), false);
  assert.equal(isAuthorizedLocalShutdown({ remoteAddress: "127.0.0.1", authorization: "Bearer wrong", expectedToken: token }), false);
  assert.equal(isAuthorizedLocalShutdown({ remoteAddress: "127.0.0.1", authorization: `Bearer ${token}`, expectedToken: "short" }), false);
});

test("health metadata exposes the running build and state revision without secret fields", () => {
  const metadata = runtimeMetadata({
    pid: 1234, sourceCommit: "c5d24a9", sourceDirty: true,
    state: { schemaVersion: 5, revision: 81 }
  });
  assert.deepEqual(metadata, { pid: 1234, sourceCommit: "c5d24a9", sourceDirty: true, schemaVersion: 5, stateRevision: 81 });
  assert.equal("token" in metadata, false);
  assert.equal("stateFile" in metadata, false);
});

test("managed service health reports its process and graceful shutdown releases the writer lock", async (context) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "seeding-lifecycle-test-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const port = await unusedPort();
  const operatorToken = randomBytes(32).toString("hex");
  const automationToken = randomBytes(32).toString("hex");
  const controlToken = randomBytes(32).toString("hex");
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: appRoot,
    env: {
      ...process.env,
      OPENSSL_CONF: "",
      SEEDING_DATA_DIR: dataDir,
      SEEDING_HOST: "127.0.0.1",
      SEEDING_PORT: String(port),
      SEEDING_OPERATOR_TOKEN: operatorToken,
      SEEDING_AUTOMATION_TOKEN: automationToken,
      SEEDING_CONTROL_TOKEN: controlToken,
      SEEDING_BUILD_COMMIT: "c5d24a9",
      SEEDING_BUILD_DIRTY: "false",
      SEEDING_HEALTH_NONCE: "fixture-health-nonce"
    },
    stdio: "ignore"
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const health = await waitForHealth(baseUrl, child);
    assert.deepEqual(health.runtime, {
      pid: child.pid,
      sourceCommit: "c5d24a9",
      sourceDirty: false,
      schemaVersion: 8,
      stateRevision: 0
    });
    assert.deepEqual(health.serviceOwnership, {
      service: "marketing-seeding",
      nonce: "fixture-health-nonce",
      sourceCommit: "c5d24a9"
    });
    assert.equal(health.campaignQueue.enabled, true);
    assert.equal(health.campaignQueue.intervalSeconds, 30);
    assert.equal(health.campaignQueue.running, false);
    assert.ok(health.campaignQueue.nextRunAt);
    assert.equal("stateFile" in health.campaignQueue, false);
    assert.equal("error" in health.campaignQueue, false);
    const lockPath = path.join(dataDir, "state.json.writer.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    assert.equal(lock.pid, child.pid);
    await writeFile(path.join(dataDir, "server.pid.json"), JSON.stringify({ pid: child.pid, supervisorPid: process.pid }));

    if (process.platform === "win32") {
      const statusScript = path.join(appRoot, "Get-SeedingDashboardStatus.ps1");
      const statusText = execFileSync("powershell.exe", [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", statusScript,
        "-Port", String(port), "-TaskName", "seeding-lifecycle-test-not-installed"
      ], { env: { ...process.env, SEEDING_DATA_DIR: dataDir }, encoding: "utf8" });
      const status = JSON.parse(statusText);
      assert.equal(status.ready, true, JSON.stringify(status));
      assert.equal(status.pid, child.pid);
      assert.equal(status.portOwnerPid, child.pid);
      assert.equal(status.writerLockPid, child.pid);
      assert.equal(status.writerLockMatchesService, true);
      assert.equal(status.sourceCommit, "c5d24a9");
      assert.equal(status.schemaVersion, 8);
      assert.equal(status.stateRevision, 0);
      await writeFile(path.join(dataDir, "server.pid.json"), JSON.stringify({ pid: child.pid + 100000, supervisorPid: 999999 }));
      const staleStatusText = execFileSync("powershell.exe", [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", statusScript,
        "-Port", String(port), "-TaskName", "seeding-lifecycle-test-not-installed"
      ], { env: { ...process.env, SEEDING_DATA_DIR: dataDir }, encoding: "utf8" });
      const staleStatus = JSON.parse(staleStatusText);
      assert.equal(staleStatus.stalePidRecord, true);
      assert.equal(staleStatus.pid, child.pid);
      assert.equal(staleStatus.writerLockMatchesService, true);
    }

    const contender = new JsonStore(path.join(dataDir, "state.json"), { requireLease: true });
    await assert.rejects(contender.acquireWriterLease(), /already held/);

    const denied = await fetch(`${baseUrl}/internal/shutdown`, { method: "POST" });
    assert.equal(denied.status, 404);
    assert.equal(child.exitCode, null);

    const accepted = await fetch(`${baseUrl}/internal/shutdown`, {
      method: "POST", headers: { authorization: `Bearer ${controlToken}` }
    });
    assert.equal(accepted.status, 202);
    assert.deepEqual(await accepted.json(), { ok: true, shutdown: "accepted" });
    const exit = await waitForExit(child);
    assert.equal(exit.code, 0);
    await assert.rejects(readFile(lockPath), { code: "ENOENT" });
    await assert.rejects(fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) }));
  } finally {
    if (child.exitCode === null) {
      try {
        await fetch(`${baseUrl}/internal/shutdown`, {
          method: "POST", headers: { authorization: `Bearer ${controlToken}` }, signal: AbortSignal.timeout(1_000)
        });
        await waitForExit(child, 3_000);
      } catch { child.kill(); }
    }
  }
});

test("lifecycle scripts keep the supervisor alive on the child handle and stop without taskkill", async () => {
  const supervisor = await readFile(path.join(appRoot, "Start-SeedingDashboard-Supervisor.ps1"), "utf8");
  const stop = await readFile(path.join(appRoot, "Stop-SeedingDashboard.ps1"), "utf8");
  const start = await readFile(path.join(appRoot, "Start-SeedingDashboard.ps1"), "utf8");
  assert.match(supervisor, /-ManagedChild/);
  assert.match(supervisor, /\.WaitForExit\(\)/);
  assert.match(supervisor, /supervisor retains ownership and will continue waiting/);
  assert.match(supervisor, /server\.supervisor\.lock/);
  assert.match(start, /-PassThru/);
  assert.match(start, /server\.pid\.json/);
  assert.match(stop, /\/internal\/shutdown/);
  assert.match(stop, /writer lock/);
  assert.doesNotMatch(stop, /taskkill|Stop-Process|\.Kill\(/i);
});
