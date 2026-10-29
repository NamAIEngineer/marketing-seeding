import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import http from "node:http";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(new URL("..", import.meta.url).pathname);

test("packaged launcher probes the server's /health route", async () => {
  const launcher = await readFile(path.join(root, "desktop/build-macos.sh"), "utf8");
  const server = await readFile(path.join(root, "src/server.mjs"), "utf8");
  assert.equal(launcher.includes("/health/live"), false);
  assert.ok((launcher.match(/\/health/g) || []).length >= 2);
  assert.match(server, /url\.pathname === ["']\/health["']/);
  assert.match(launcher, /health-probe\.mjs/);
  assert.match(launcher, /health-nonce/);
});

test("updater rejects an unrelated app bundle before swap", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-wrong-app-"));
  const app = path.join(fixture, "Wrong.app");
  await mkdir(path.join(app, "Contents", "MacOS"), { recursive: true });
  await mkdir(path.join(app, "Contents", "Resources", "app"), { recursive: true });
  await writeFile(path.join(app, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.example.foreign</string><key>CFBundleExecutable</key><string>launch</string></dict></plist>`);
  await writeFile(path.join(app, "Contents", "MacOS", "launch"), "#!/bin/sh\n");
  await execFileAsync("chmod", ["+x", path.join(app, "Contents", "MacOS", "launch")]);
  await assert.rejects(execFileAsync("sh", [path.join(root, "desktop/update-macos.sh"), app], { env: { ...process.env, SEEDING_UPDATE_VALIDATE_TEST: "1" } }), /bundle identifier mismatch/);
});

test("launcher health probe rejects a foreign service collision on the fixed port", async (context) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "global-seeding", serviceOwnership: { service: "other-app", nonce: "foreign", sourceCommit: "foreign" } }));
  });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  context.after(() => server.close());
  const { port } = server.address();
  const probe = path.join(root, "desktop/health-probe.mjs");
  await assert.rejects(execFileAsync(process.execPath, [probe, `http://127.0.0.1:${port}/health`, "expected-nonce", "expected-commit"]), /health ownership service mismatch/);
});

test("malformed update manifest is fail-closed through the server route", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-update-server-"));
  const token = "o".repeat(64);
  const automationToken = "a".repeat(64);
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      SEEDING_DATA_DIR: dataDir,
      SEEDING_HOST: "127.0.0.1",
      SEEDING_PORT: "0",
      SEEDING_OPERATOR_TOKEN: token,
      SEEDING_AUTOMATION_TOKEN: automationToken,
      SEEDING_RELEASE_MANIFEST_URL: "not-a-url",
      SEEDING_UPDATE_POLL_MINUTES: "0",
      SEEDING_TRAFFIC_POLL_MINUTES: "0",
      SEEDING_DISCOVERY_POLL_MINUTES: "0",
      SEEDING_JEV_WORKER_ENABLED: "false",
      SEEDING_CONTENT_AUTO_PROVISION: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 10_000);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      const match = output.match(/dashboard: http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
  });
  try {
    const port = await ready;
    const response = await fetch(`http://127.0.0.1:${port}/api/update/status`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "UNAVAILABLE");
    assert.equal(body.automaticUpdates, false);
    assert.equal(body.installEligible, false);
    assert.equal(body.updateAvailable, false);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("close", resolve));
  }
});

test("update swap installs a new app at exact path and preserves external state", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-update-"));
  const current = path.join(fixture, "Marketing Seeding OS.app");
  const staged = path.join(fixture, ".Marketing-Seeding-OS.new.app");
  const data = path.join(fixture, "state.json");
  await mkdir(current);
  await mkdir(staged);
  await writeFile(path.join(current, "old.txt"), "old\n");
  await writeFile(path.join(staged, "new.txt"), "new\n");
  await writeFile(data, "state-preserved\n");
  await execFileAsync("sh", [path.join(root, "desktop/update-macos.sh"), current, staged], { env: { ...process.env, SEEDING_UPDATE_SWAP_TEST: "1" } });
  await assert.rejects(access(path.join(current, "old.txt")));
  assert.equal(await readFile(path.join(current, "new.txt"), "utf8"), "new\n");
  assert.equal(await readFile(data, "utf8"), "state-preserved\n");
  await assert.rejects(access(staged));
});

test("update swap restores old app when staged move cannot complete", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-update-rollback-"));
  const current = path.join(fixture, "Marketing Seeding OS.app");
  const staged = path.join(fixture, ".Marketing-Seeding-OS.missing.app");
  await mkdir(current);
  await writeFile(path.join(current, "old.txt"), "old\n");
  await assert.rejects(
    execFileAsync("sh", [path.join(root, "desktop/update-macos.sh"), current, staged], { env: { ...process.env, SEEDING_UPDATE_SWAP_TEST: "1" } }),
  );
  assert.equal(await readFile(path.join(current, "old.txt"), "utf8"), "old\n");
  const entries = await (await import("node:fs/promises")).readdir(fixture);
  assert.equal(entries.some((entry) => entry.startsWith(".Marketing-Seeding-OS.rollback.")), false);
});
