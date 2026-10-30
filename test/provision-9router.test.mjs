import test from "node:test";
import assert from "node:assert/strict";
import { chmod, cp, lstat, mkdtemp, mkdir, readFile, readdir, readlink, symlink, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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

const sha512 = (bytes) => createHash("sha512").update(bytes).digest("hex");

async function packageTreeDigest(directory) {
  const rows = [];
  async function walk(current, relative = "") {
    for (const name of (await readdir(current)).sort()) {
      if (!relative && name === "node_modules") continue;
      const absolute = path.join(current, name);
      const child = relative ? `${relative}/${name}` : name;
      const stat = await lstat(absolute);
      if (stat.isDirectory()) await walk(absolute, child);
      else if (stat.isSymbolicLink()) rows.push(`${child}\tSYMLINK\t${await readlink(absolute)}`);
      else if (stat.isFile()) rows.push(`${child}\tFILE\t${sha512(await readFile(absolute))}`);
      else rows.push(`${child}\tOTHER\t${stat.mode}`);
    }
  }
  await walk(directory);
  return sha512(Buffer.from(`${rows.join("\n")}\n`));
}

async function createFixturePackage(dir) {
  const source = path.join(dir, "source", "9router");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "package.json"), `${JSON.stringify({ name: "9router", version: provenance.version, bin: { "9router": "cli.js" } }, null, 2)}\n`);
  const cli = path.join(source, "cli.js");
  await writeFile(cli, "#!/usr/bin/env node\nif (process.argv.includes(\"--version\")) process.stdout.write(\"0.5.109\\n\");\n");
  await chmod(cli, 0o755);
  return source;
}

async function lockText() {
  return JSON.stringify({ packages: { "fixture/node_modules/9router": { version: provenance.version, resolved: provenance.tarball, integrity: provenance.integrity } } });
}

async function fixture(mode) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-9router-"));
  const source = await createFixturePackage(dir);
  const packageJson = path.join(source, "package.json");
  const cli = path.join(source, "cli.js");
  const hashes = {
    packageJson: sha512(await readFile(packageJson)),
    cli: sha512(await readFile(cli)),
    tree: await packageTreeDigest(source),
  };
  const npm = path.join(dir, "npm-fixture.mjs");
  const script = `#!/usr/bin/env node
import { cp, mkdir, symlink, writeFile } from "node:fs/promises";
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
await cp(process.env.FIXTURE_SOURCE, packageRoot, { recursive: true });
await symlink("../9router/cli.js", path.join(binRoot, "9router"));
await writeFile(path.join(prefix, "node_modules", ".package-lock.json"), ${JSON.stringify(await lockText())});
`;
  await writeFile(npm, script);
  await chmod(npm, 0o755);

  // The production script's digest constants remain real 9router tarball values.
  // This copied script substitutes only fixture-derived bytes so the tests stay
  // deterministic and exercise the same verification logic without claiming the
  // synthetic fixture represents the public package.
  const fixtureProvisioner = path.join(dir, "provision-9router.sh");
  let provisionerText = await readFile(provisioner, "utf8");
  for (const [name, value] of [["EXPECTED_PACKAGE_JSON_SHA512", hashes.packageJson], ["EXPECTED_CLI_SHA512", hashes.cli], ["EXPECTED_PACKAGE_TREE_SHA512", hashes.tree]]) {
    const updated = provisionerText.replace(new RegExp(`^${name}="[^"]*"$`, "m"), `${name}="${value}"`);
    assert.notEqual(updated, provisionerText, `missing ${name} in production provisioner`);
    provisionerText = updated;
  }
  await writeFile(fixtureProvisioner, provisionerText);
  await chmod(fixtureProvisioner, 0o755);
  return { dir, npm, source, hashes, provisioner: fixtureProvisioner };
}

async function seedRuntime(f, data) {
  const runtime = path.join(data, "9router-runtime");
  const packageRoot = path.join(runtime, "node_modules", "9router");
  const binRoot = path.join(runtime, "node_modules", ".bin");
  await cp(f.source, packageRoot, { recursive: true });
  await mkdir(binRoot, { recursive: true });
  await symlink("../9router/cli.js", path.join(binRoot, "9router"));
  await writeFile(path.join(runtime, "node_modules", ".package-lock.json"), await lockText());
  return { runtime, packageRoot, binRoot, command: path.join(binRoot, "9router") };
}

async function run(mode) {
  const f = await fixture(mode);
  const data = path.join(f.dir, "data");
  const env = { ...process.env, FIXTURE_SOURCE: f.source, SEEDING_9ROUTER_COMMAND: path.join(f.dir, "missing"), SEEDING_NPM_BIN: f.npm, SEEDING_NODE_BIN: node, SEEDING_9ROUTER_START: "false" };
  return { fixture: f, data, result: await execFileAsync("sh", [f.provisioner, data], { env }).then((value) => ({ ok: true, ...value })).catch((error) => ({ ok: false, ...error })) };
}

test("provisions a fixture package through registry-pinned metadata and lock verification", async () => {
  const runResult = await run("success");
  assert.equal(runResult.result.ok, true, runResult.result.stderr);
  assert.match(runResult.result.stdout, /9router-runtime\/node_modules\/\.bin\/9router/);
});

test("keeps production registry constants aligned with checked-in provenance", async () => {
  const checkedIn = JSON.parse(await readFile(path.join(root, "desktop/9router-provenance.json"), "utf8"));
  const script = await readFile(provisioner, "utf8");
  const constant = (name) => script.match(new RegExp(`^${name}="([^"]*)"$`, "m"))?.[1];
  assert.equal(constant("EXPECTED_REGISTRY"), checkedIn.registry);
  assert.equal(constant("EXPECTED_TARBALL"), checkedIn.tarball);
  assert.equal(constant("EXPECTED_INTEGRITY"), checkedIn.integrity);
  assert.equal(constant("EXPECTED_SHASUM"), checkedIn.shasum);
  assert.equal(constant("EXPECTED_SIGNATURE_KEYID"), checkedIn.signatureKeyIds[0]);
  assert.deepEqual([constant("EXPECTED_SIGNATURE_1"), constant("EXPECTED_SIGNATURE_2")], checkedIn.signatures);
  for (const name of ["EXPECTED_PACKAGE_JSON_SHA512", "EXPECTED_CLI_SHA512", "EXPECTED_PACKAGE_TREE_SHA512"]) assert.match(constant(name), /^[a-f0-9]{128}$/);
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
  await symlink(path.join(f.source, "cli.js"), command);
  const data = path.join(f.dir, "data");
  const result = await execFileAsync("sh", [f.provisioner, data], { env: { ...process.env, SEEDING_9ROUTER_COMMAND: command, SEEDING_NPM_BIN: path.join(f.dir, "missing-npm"), SEEDING_NODE_BIN: node, SEEDING_9ROUTER_START: "false" } });
  assert.equal(result.stdout.trim(), command);
});

test("reuses an integrity-verified runtime package without requiring registry access", async () => {
  const f = await fixture("reuse-runtime");
  const data = path.join(f.dir, "data");
  const { runtime } = await seedRuntime(f, data);
  const result = await execFileAsync("sh", [f.provisioner, data], { env: { ...process.env, SEEDING_9ROUTER_COMMAND: path.join(f.dir, "missing"), SEEDING_NPM_BIN: path.join(f.dir, "missing-npm"), SEEDING_NODE_BIN: node, SEEDING_9ROUTER_START: "false" } });
  assert.equal(result.stdout.trim(), path.join(runtime, "node_modules", ".bin", "9router"));
});

test("rejects a mutated offline runtime even when version and lock metadata still match", async () => {
  const f = await fixture("mutated-runtime");
  const data = path.join(f.dir, "data");
  const { binRoot } = await seedRuntime(f, data);
  await unlink(path.join(binRoot, "9router"));
  await writeFile(path.join(binRoot, "9router"), "#!/bin/sh\nprintf '%s\\n' '0.5.109'\n");
  await chmod(path.join(binRoot, "9router"), 0o755);
  await assert.rejects(
    execFileAsync("sh", [f.provisioner, data], { env: { ...process.env, SEEDING_9ROUTER_COMMAND: path.join(f.dir, "missing"), SEEDING_NPM_BIN: path.join(f.dir, "missing-npm"), SEEDING_NODE_BIN: node, SEEDING_9ROUTER_START: "false" } }),
    /installed package bytes or provenance mismatch/,
  );
  assert.match(await readFile(path.join(data, "9router-provision-status"), "utf8"), /^UNAVAILABLE:/);
});

test("rejects a mutated offline package tree even when entrypoint bytes are unchanged", async () => {
  const f = await fixture("mutated-tree");
  const data = path.join(f.dir, "data");
  const { packageRoot } = await seedRuntime(f, data);
  await writeFile(path.join(packageRoot, "unexpected.txt"), "tampered package tree\n");
  await assert.rejects(
    execFileAsync("sh", [f.provisioner, data], { env: { ...process.env, SEEDING_9ROUTER_COMMAND: path.join(f.dir, "missing"), SEEDING_NPM_BIN: path.join(f.dir, "missing-npm"), SEEDING_NODE_BIN: node, SEEDING_9ROUTER_START: "false" } }),
    /installed package bytes or provenance mismatch/,
  );
  assert.match(await readFile(path.join(data, "9router-provision-status"), "utf8"), /^UNAVAILABLE:/);
});
