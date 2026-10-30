import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, access, chmod, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import http from "node:http";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(new URL("..", import.meta.url).pathname);

function embeddedDesktopScript(build, filename, marker) {
  const start = `cat > \"$APP/Contents/MacOS/${filename}\" <<'${marker}'\n`;
  const offset = build.indexOf(start);
  assert.notEqual(offset, -1, `missing embedded ${filename} script`);
  const bodyStart = offset + start.length;
  const end = build.indexOf(`\n${marker}\n`, bodyStart);
  assert.notEqual(end, -1, `unterminated embedded ${filename} script`);
  return build.slice(bodyStart, end);
}

test("packaged launcher probes the server's /health route", async () => {
  const launcher = await readFile(path.join(root, "desktop/build-macos.sh"), "utf8");
  const server = await readFile(path.join(root, "src/server.mjs"), "utf8");
  const provenance = JSON.parse(await readFile(path.join(root, "desktop/9router-provenance.json"), "utf8"));
  assert.equal(launcher.includes("/health/live"), false);
  assert.ok((launcher.match(/\/health/g) || []).length >= 2);
  assert.match(server, /url\.pathname === ["']\/health["']/);
  assert.match(launcher, /health-probe\.mjs/);
  assert.match(launcher, /health-nonce/);
  assert.match(launcher, /9router-provenance\.json/);
  assert.match(launcher, /SEEDING_JEV_WORKER_ENABLED=.*true/);
  assert.match(launcher, /SEEDING_JEV_LIVE_ENABLED=.*true/);
  assert.match(launcher, /SEEDING_JEV_AUTONOMOUS_LIVE_ENABLED=.*true/);
  assert.match(launcher, /<key>EnvironmentVariables<\/key><dict>/);
  for (const key of [
    "HOME",
    "SEEDING_DATA_DIR",
    "SEEDING_OPERATOR_TOKEN",
    "SEEDING_AUTOMATION_TOKEN",
    "SEEDING_CONTROL_TOKEN",
    "SEEDING_HEALTH_NONCE",
    "SEEDING_BUILD_COMMIT",
    "SEEDING_NODE_BIN",
    "SEEDING_NPM_BIN",
    "SEEDING_9ROUTER_ENDPOINT",
    "SEEDING_CONTENT_AUTO_PROVISION",
    "SEEDING_CONTENT_MODE",
    "SEEDING_JEV_WORKER_ENABLED",
    "SEEDING_JEV_LIVE_ENABLED",
    "SEEDING_JEV_AUTONOMOUS_LIVE_ENABLED"
  ]) assert.match(launcher, new RegExp(`<key>${key}<\\/key>`));
  assert.equal(provenance.package, "9router");
  assert.equal(provenance.version, "0.5.109");
  assert.match(provenance.tarball, /^https:\/\/registry\.npmjs\.org\/9router\/-\/9router-0\.5\.109\.tgz$/);
});

test("packaged launchd scripts keep state and secrets inside the app-scoped data root", async (context) => {
  const build = await readFile(path.join(root, "desktop/build-macos.sh"), "utf8");
  const launch = embeddedDesktopScript(build, "launch", "LAUNCH");
  const service = embeddedDesktopScript(build, "service", "SERVICE");
  assert.match(launch, /DATA_ROOT=\"\$\{SEEDING_DATA_DIR:-\$HOME\/Library\/Application Support\/Marketing Seeding OS\}\"/);
  assert.match(service, /DATA_ROOT=\"\$\{SEEDING_DATA_DIR:-\$HOME\/Library\/Application Support\/Marketing Seeding OS\}\"/);

  const fixture = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-launchd-isolation-"));
  context.after(() => rm(fixture, { recursive: true, force: true }));
  const contents = path.join(fixture, "Contents");
  const app = path.join(contents, "Resources", "app");
  const bin = path.join(contents, "Resources", "bin");
  const macos = path.join(contents, "MacOS");
  await mkdir(app, { recursive: true });
  await mkdir(bin, { recursive: true });
  await mkdir(macos, { recursive: true });
  await writeFile(path.join(app, "source-commit.txt"), "fixture-commit\n");
  const fakeNode = `#!/bin/sh\nset -eu\nif [ -n \"${"$SEEDING_NODE_ENV_OUTPUT"}\" ]; then env | sort > \"$SEEDING_NODE_ENV_OUTPUT\"; fi\nexit 0\n`;
  await writeFile(path.join(bin, "node"), fakeNode);
  await chmod(path.join(bin, "node"), 0o755);
  const fakeWebview = `#!/bin/sh\nset -eu\nenv | sort > \"$SEEDING_WEBVIEW_ENV_OUTPUT\"\nexit 0\n`;
  await writeFile(path.join(macos, "webview"), fakeWebview);
  await chmod(path.join(macos, "webview"), 0o755);
  const launchPath = path.join(macos, "launch");
  await writeFile(launchPath, launch);
  await chmod(launchPath, 0o755);

  const home = path.join(fixture, "home");
  const dataRoot = path.join(fixture, "runtime-data");
  const nodeOutput = path.join(fixture, "node-env.txt");
  const webviewOutput = path.join(fixture, "webview-env.txt");
  await mkdir(home, { recursive: true });
  await execFileAsync("/bin/sh", [launchPath], {
    env: {
      ...process.env,
      HOME: home,
      SEEDING_DATA_DIR: dataRoot,
      SEEDING_NODE_ENV_OUTPUT: nodeOutput,
      SEEDING_WEBVIEW_ENV_OUTPUT: webviewOutput
    }
  });
  for (const filename of ["health-nonce", "operator-token", "automation-token", "control-token"]) {
    await access(path.join(dataRoot, filename));
  }
  await assert.rejects(access(path.join(home, "Library", "Application Support", "Marketing Seeding OS")));
  const launcherEnv = await readFile(webviewOutput, "utf8");
  assert.match(launcherEnv, new RegExp(`SEEDING_DATA_DIR=${dataRoot.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`));
  assert.match(launcherEnv, /SEEDING_OPERATOR_TOKEN=[0-9a-f]{64}/);
  assert.match(launcherEnv, /SEEDING_AUTOMATION_TOKEN=[0-9a-f]{64}/);
  assert.match(launcherEnv, /SEEDING_CONTROL_TOKEN=[0-9a-f]{64}/);

  const servicePath = path.join(macos, "service");
  await writeFile(servicePath, service);
  await chmod(servicePath, 0o755);
  const serviceDataRoot = path.join(fixture, "service-data");
  const serviceHome = path.join(fixture, "service-home");
  const serviceOutput = path.join(fixture, "service-env.txt");
  await mkdir(serviceHome, { recursive: true });
  await execFileAsync("/bin/sh", [servicePath], {
    env: {
      ...process.env,
      HOME: serviceHome,
      SEEDING_DATA_DIR: serviceDataRoot,
      SEEDING_OPERATOR_TOKEN: "o".repeat(64),
      SEEDING_AUTOMATION_TOKEN: "a".repeat(64),
      SEEDING_CONTROL_TOKEN: "c".repeat(64),
      SEEDING_HEALTH_NONCE: "fixture-nonce",
      SEEDING_NODE_ENV_OUTPUT: serviceOutput
    }
  });
  const serviceEnv = await readFile(serviceOutput, "utf8");
  assert.match(serviceEnv, new RegExp(`SEEDING_DATA_DIR=${serviceDataRoot.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`));
  assert.match(serviceEnv, /SEEDING_CONTROL_TOKEN=c{64}/);
  await assert.rejects(access(path.join(serviceHome, "Library", "Application Support", "Marketing Seeding OS")));
});

test('desktop build refuses dirty source unless explicitly overridden', async () => {
  const build = await readFile(path.join(root, 'desktop/build-macos.sh'), 'utf8');
  assert.match(build, /SEEDING_ALLOW_DIRTY_BUILD/);
  assert.match(build, /git -C "\$SOURCE" status --porcelain/);
  assert.match(build, /refusing dirty build/);
  assert.match(build, /exit 2/);
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

test("updater requires an explicit signer gate for a valid-shaped candidate", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-signer-gate-"));
  const app = path.join(fixture, "Marketing Seeding OS.app");
  await mkdir(path.join(app, "Contents", "MacOS"), { recursive: true });
  await mkdir(path.join(app, "Contents", "Resources", "app"), { recursive: true });
  await writeFile(path.join(app, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>ai.marketing-seeding.local</string><key>CFBundleExecutable</key><string>launch</string></dict></plist>`);
  await writeFile(path.join(app, "Contents", "MacOS", "launch"), "#!/bin/sh\n");
  await execFileAsync("chmod", ["+x", path.join(app, "Contents", "MacOS", "launch")]);
  await writeFile(path.join(app, "Contents", "Resources", "app", "source-commit.txt"), "fixture\n");
  await writeFile(path.join(app, "Contents", "Resources", "app", "update-macos.sh"), "#!/bin/sh\n");
  await writeFile(path.join(app, "Contents", "Resources", "app", "package.json"), "{}\n");
  await assert.rejects(execFileAsync("sh", [path.join(root, "desktop/update-macos.sh"), app], { env: { ...process.env, SEEDING_UPDATE_VALIDATE_TEST: "1" } }), /expected signer Team ID is not configured/);
});

test("updater rejects an archive containing multiple app bundles", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-multiple-apps-"));
  await mkdir(path.join(fixture, "Marketing Seeding OS.app"), { recursive: true });
  await mkdir(path.join(fixture, "Other.app"), { recursive: true });
  await assert.rejects(execFileAsync("sh", [path.join(root, "desktop/update-macos.sh"), fixture], { env: { ...process.env, SEEDING_UPDATE_ARCHIVE_SELECT_TEST: "1" } }), /exactly one app bundle/);
});

test("packaged service preserves typed 9Router provisioning failures", async () => {
  const build = await readFile(path.join(root, "desktop/build-macos.sh"), "utf8");
  assert.match(build, /9router-provision-status/);
  assert.match(build, /UNAVAILABLE:/);
  assert.match(build, /grep -q '\^UNAVAILABLE:'/);
  assert.doesNotMatch(build, /printf '%s\\n' "provision_failed"/);
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
