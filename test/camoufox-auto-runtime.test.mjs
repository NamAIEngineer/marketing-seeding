import assert from "node:assert/strict";
import test from "node:test";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createAutoCamoufoxExecutionSessionResolver, createAutoCamoufoxProvisioner } from "../src/camoufox-auto-runtime.mjs";

const execFileAsync = promisify(execFile);
const provisionScript = path.resolve(new URL("../desktop/provision-camoufox.sh", import.meta.url).pathname);

const IDENTITY = "https://www.linkedin.com/in/owner";

function fakeRuntime() {
  const released = [];
  const coordinator = {
    async acquire({ profileReference }) { return { ready: true, status: "LEASED", handle: { profileReference, profileFingerprint: "sha256:profile" } }; },
    async release(handle) { released.push(handle.profileReference); return { released: true }; },
    protocolFactory() {
      return async () => ({
        async attach() {},
        async observeIdentity() { return { state: "READY", provider: "camoufox", platform: "linkedin", accountId: "acct-1", providerProfileId: "profile-1", identityReference: IDENTITY }; },
        async navigate() {}, async snapshot() { return ""; }, async resolve() {}, async type() {}, async click() {}, async observeTransition() {}, async verifyActivation() {}, async detach() {}
      });
    }
  };
  return { coordinator, released };
}

test("auto Camoufox resolver provisions lazily from sanitized canonical account state", async () => {
  const runtime = fakeRuntime();
  let provisions = 0;
  const resolver = createAutoCamoufoxExecutionSessionResolver({
    runtimeRoot: "/tmp/marketing-seeding-test-runtime",
    profileRoot: "/tmp/marketing-seeding-test-profiles",
    provisionRuntime: async () => { provisions += 1; return { ...runtime, packageVersion: "0.5.8" }; },
    stateReader: async () => ({ executionAccounts: [{ platform: "linkedin", accountId: "acct-1", provider: "camoufox", profileId: "profile-1", providerProfileId: "profile-1", identityReference: IDENTITY, health: "healthy", status: "enabled" }] })
  });
  const envelope = await resolver.acquire({ provider: "camoufox", platform: "linkedin", accountId: "acct-1", providerProfileId: "profile-1", profileId: "profile-1", identityReference: IDENTITY });
  assert.equal(envelope.ready, true);
  assert.equal(envelope.session.provider, "camoufox");
  assert.equal(envelope.session.accountId, "acct-1");
  assert.equal(provisions, 1);
  await envelope.release();
  assert.deepEqual(runtime.released, ["profile-1"]);
});

test("auto Camoufox resolver rejects an account without verified identity binding", async () => {
  const runtime = fakeRuntime();
  const resolver = createAutoCamoufoxExecutionSessionResolver({
    provisionRuntime: async () => ({ ...runtime, packageVersion: "0.5.8" }),
    stateReader: async () => ({ executionAccounts: [{ platform: "linkedin", accountId: "acct-unknown", provider: "camoufox", profileId: "profile-unknown", providerProfileId: "profile-unknown", health: "unknown", status: "enabled" }] })
  });
  const result = await resolver.acquire({ provider: "camoufox", platform: "linkedin", accountId: "acct-unknown", providerProfileId: "profile-unknown", profileId: "profile-unknown" });
  assert.equal(result.ready, false);
  assert.equal(result.code, "PROFILE_BINDING_MISSING");
});

async function fixturePackage({ mode = "success" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-camoufox-provision-"));
  const dist = path.join(root, "node_modules", "camoufox", "dist");
  await mkdir(dist, { recursive: true, mode: 0o700 });
  await writeFile(path.join(root, "node_modules", "camoufox", "package.json"), '{"name":"camoufox","version":"0.5.8","type":"module"}\n');
  // The public index intentionally has no package-manager helpers in 0.5.8;
  // this fixture proves the resolver follows the supported dist/pkgman.js API.
  await writeFile(path.join(dist, "index.js"), "export const Camoufox = () => undefined;\n");
  const escaped = path.join(root, "outside-browser");
  const manager = mode === "offline"
    ? "export async function ensureCamoufoxInstalled() { throw new Error('network unavailable'); }\nexport function launchPath() { throw new Error('unreachable'); }\n"
    : mode === "escape"
      ? `export async function ensureCamoufoxInstalled() { return ${JSON.stringify(escaped)}; }\nexport function launchPath(browser) { return browser + '/camoufox'; }\n`
      : `import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
export async function ensureCamoufoxInstalled() {
  const browser = path.join(process.env.HOME, 'Library', 'Caches', 'camoufox', 'fixture');
  const executable = path.join(browser, 'Camoufox.app', 'Contents', 'MacOS', 'camoufox');
  await mkdir(path.dirname(executable), { recursive: true });
  await writeFile(executable, '#!/bin/sh\\nexit 0\\n');
  await chmod(executable, 0o755);
  return browser;
}
export function launchPath(browser) { return path.join(browser, 'Camoufox.app', 'Contents', 'MacOS', 'camoufox'); }
`;
  await writeFile(path.join(dist, "pkgman.js"), manager);
  return root;
}

test("auto provisioner resolves camoufox@0.5.8 package-manager exports into managed cache", async () => {
  const root = await fixturePackage();
  try {
    const provision = createAutoCamoufoxProvisioner({ root, profiles: path.join(root, "profiles") });
    const runtime = await provision();
    assert.equal(runtime.packageVersion, "0.5.8");
    assert.equal(runtime.browserPath.startsWith(path.join(root, ".camoufox-home")), true);
    assert.match(runtime.executablePath, /Camoufox\.app[\\/]Contents[\\/]MacOS[\\/]camoufox$/);
    assert.equal((await readFile(runtime.executablePath, "utf8")).startsWith("#!/bin/sh"), true);
    assert.equal((await provision()).executablePath, runtime.executablePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("auto provisioner maps browser download failure to a typed unavailable error", async () => {
  const root = await fixturePackage({ mode: "offline" });
  try {
    const provision = createAutoCamoufoxProvisioner({ root, profiles: path.join(root, "profiles") });
    await assert.rejects(provision(), { code: "CAMOUFOX_BROWSER_INSTALL_FAILED" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("auto provisioner rejects a browser path outside the per-user managed cache", async () => {
  const root = await fixturePackage({ mode: "escape" });
  try {
    const provision = createAutoCamoufoxProvisioner({ root, profiles: path.join(root, "profiles") });
    await assert.rejects(provision(), { code: "CAMOUFOX_BROWSER_INSTALL_FAILED" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("packaged provision script uses the pkgman API and writes only managed runtime metadata", async () => {
  const root = await fixturePackage();
  const fixtureNpm = path.join(root, "npm-fixture.mjs");
  await writeFile(fixtureNpm, `#!/usr/bin/env node
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
const args = process.argv.slice(2);
const prefix = args[args.indexOf("--prefix") + 1];
await mkdir(path.join(prefix, "node_modules"), { recursive: true });
await cp(process.env.CAMOUFOX_FIXTURE_PACKAGE, path.join(prefix, "node_modules", "camoufox"), { recursive: true });
`);
  await chmod(fixtureNpm, 0o755);
  try {
    const data = path.join(root, "data");
    const result = await execFileAsync("sh", [provisionScript, data], {
      env: {
        ...process.env,
        CAMOUFOX_FIXTURE_PACKAGE: path.join(root, "node_modules", "camoufox"),
        SEEDING_NODE_BIN: process.execPath,
        SEEDING_NPM_BIN: fixtureNpm
      },
      timeout: 30_000
    });
    assert.equal(result.stderr, "");
    assert.equal((await readFile(path.join(data, "camoufox-provision-status"), "utf8")).trim(), "ready");
    const metadata = JSON.parse(await readFile(path.join(data, "camoufox-runtime.json"), "utf8"));
    assert.equal(metadata.runtimeRoot, path.join(data, "camoufox-runtime"));
    assert.equal(metadata.browserPath.startsWith(path.join(data, "camoufox-runtime", ".camoufox-home")), true);
    assert.equal(metadata.executablePath.startsWith(metadata.browserPath), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
