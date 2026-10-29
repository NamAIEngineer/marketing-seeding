import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(new URL("..", import.meta.url).pathname);
const provisioner = path.join(root, "desktop/provision-9router.sh");
const node = process.execPath;

const provenance = {
  package: "9router",
  version: "0.5.109",
  registry: "https://registry.npmjs.org",
  tarball: "https://registry.npmjs.org/9router/-/9router-0.5.109.tgz",
  integrity: "sha512-MKI/tfQSpMhToVyVkXanHddxdfD1YQGYR4+jCxjGrMxz1xNrbR6WuNmY2+jpV745JOvGz9wlDel+APodwaEyfw==",
  shasum: "cf6381207a57f7e3cb4cb29f373bb15445fba68a",
  keyid: "SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U",
  signatures: [
    "MEUCIQDYltJeFmu1IcIYoe0Up/QMPy0qGgXJgYBfGCz5dSBgOgIgLi1GmJJnSvrAk6jJYwx84gRSGVFLZ/HU+iMofIs4qRs=",
    "MEUCIC/vO3HjXNghlrDgPz87z8WQ+gil72dTnbxSA1GhqHCHAiEAp/n840jBFF9+QxCFpq6uhAJv4pRhNqX1qT5CjOrOt+o=",
  ],
};

async function fixture(mode) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-9router-"));
  const npm = path.join(dir, "npm-fixture.mjs");
  const script = `#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const args = process.argv.slice(2);
const mode = ${JSON.stringify(mode)};
const provenance = ${JSON.stringify(provenance)};
if (args[0] === "view") {
  if (mode === "metadata-mismatch") provenance.integrity = "sha512-mismatch";
  process.stdout.write(JSON.stringify({ tarball: provenance.tarball, integrity: provenance.integrity, shasum: provenance.shasum, signatures: provenance.signatures.map((sig) => ({ keyid: provenance.keyid, sig })) }));
  process.exit(0);
}
if (args[0] !== "install") process.exit(3);
if (mode === "missing-package") process.exit(0);
const prefix = args[args.indexOf("--prefix") + 1];
const packageRoot = path.join(prefix, "node_modules", "9router");
const binRoot = path.join(prefix, "node_modules", ".bin");
await mkdir(binRoot, { recursive: true });
await mkdir(packageRoot, { recursive: true });
await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "9router", version: provenance.version }));
await writeFile(path.join(binRoot, "9router"), "#!/bin/sh\\nprintf '%s\\n' '0.5.109'\\n");
await (await import("node:fs/promises")).chmod(path.join(binRoot, "9router"), 0o755);
await writeFile(path.join(prefix, "node_modules", ".package-lock.json"), JSON.stringify({ packages: { [path.join("fixture", "node_modules", "9router")]: { version: provenance.version, resolved: provenance.tarball, integrity: provenance.integrity } } }));
`;
  await writeFile(npm, script);
  await chmod(npm, 0o755);
  return { dir, npm };
}

async function run(mode) {
  const f = await fixture(mode);
  const data = path.join(f.dir, "data");
  const env = { ...process.env, SEEDING_9ROUTER_COMMAND: path.join(f.dir, "missing"), SEEDING_NPM_BIN: f.npm, SEEDING_NODE_BIN: node, SEEDING_9ROUTER_START: "false" };
  return { fixture: f, data, result: await execFileAsync("sh", [provisioner, data], { env }).then((value) => ({ ok: true, ...value })).catch((error) => ({ ok: false, ...error })) };
}

test("provisions the exact registry-pinned package after metadata and lock verification", async () => {
  const checkedIn = JSON.parse(await readFile(path.join(root, "desktop/9router-provenance.json"), "utf8"));
  assert.equal(checkedIn.package, provenance.package);
  assert.equal(checkedIn.version, provenance.version);
  assert.equal(checkedIn.registry, provenance.registry);
  assert.equal(checkedIn.tarball, provenance.tarball);
  assert.equal(checkedIn.integrity, provenance.integrity);
  assert.equal(checkedIn.shasum, provenance.shasum);
  assert.deepEqual(checkedIn.signatures, provenance.signatures);
  const runResult = await run("success");
  assert.equal(runResult.result.ok, true, runResult.result.stderr);
  assert.match(runResult.result.stdout, /9router-runtime\/node_modules\/\.bin\/9router/);
});

test("rejects registry metadata integrity mismatch before package execution", async () => {
  const runResult = await run("metadata-mismatch");
  assert.equal(runResult.result.ok, false);
  assert.equal(runResult.result.code, 2);
  assert.match(runResult.result.stderr, /pinned registry metadata mismatch/);
  assert.match(await readFile(path.join(runResult.data, "9router-provision-status"), "utf8"), /^UNAVAILABLE:/);
});

test("rejects a successful npm command that leaves the pinned package missing", async () => {
  const runResult = await run("missing-package");
  assert.equal(runResult.result.ok, false);
  assert.equal(runResult.result.code, 2);
  assert.match(runResult.result.stderr, /pinned package missing after install/);
});

test("reuses an explicitly supplied verified binary without requiring npm", async () => {
  const f = await fixture("reuse");
  const command = path.join(f.dir, "verified-9router");
  await writeFile(command, "#!/bin/sh\nprintf '%s\\n' '0.5.109'\n");
  await chmod(command, 0o755);
  const data = path.join(f.dir, "data");
  const result = await execFileAsync("sh", [provisioner, data], { env: { ...process.env, SEEDING_9ROUTER_COMMAND: command, SEEDING_NPM_BIN: path.join(f.dir, "missing-npm"), SEEDING_9ROUTER_START: "false" } });
  assert.equal(result.stdout.trim(), command);
});

test("reuses an integrity-verified runtime package without requiring registry access", async () => {
  const f = await fixture("reuse-runtime");
  const runtime = path.join(f.dir, "data", "9router-runtime");
  const packageRoot = path.join(runtime, "node_modules", "9router");
  const binRoot = path.join(runtime, "node_modules", ".bin");
  await mkdir(packageRoot, { recursive: true });
  await mkdir(binRoot, { recursive: true });
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "9router", version: provenance.version }));
  await writeFile(path.join(binRoot, "9router"), "#!/bin/sh\nprintf '%s\\n' '0.5.109'\n");
  await chmod(path.join(binRoot, "9router"), 0o755);
  await writeFile(path.join(runtime, "node_modules", ".package-lock.json"), JSON.stringify({ packages: { "node_modules/9router": { version: provenance.version, resolved: provenance.tarball, integrity: provenance.integrity } } }));
  const result = await execFileAsync("sh", [provisioner, path.join(f.dir, "data")], { env: { ...process.env, SEEDING_9ROUTER_COMMAND: path.join(f.dir, "missing"), SEEDING_NPM_BIN: path.join(f.dir, "missing-npm"), SEEDING_9ROUTER_START: "false" } });
  assert.equal(result.stdout.trim(), path.join(runtime, "node_modules", ".bin", "9router"));
});
