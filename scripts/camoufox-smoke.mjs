#!/usr/bin/env node

/** Reversible, unauthenticated Camoufox runtime smoke. */
import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm, stat, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CamoufoxProfileCoordinator, readRuntimeMetadata } from "../src/camoufox-profile-coordinator.mjs";

const DEFAULT_RUNTIME = path.join(os.homedir(), "Library", "Application Support", "marketing-seeding", "camoufox-runtime-v0.5.8");
const DEFAULT_EXECUTABLE = path.join(os.homedir(), "Library", "Caches", "camoufox", "browsers", "official", "156.0.1-beta.36-0ad5663e", "Camoufox.app", "Contents", "MacOS", "camoufox");
const text = (value, limit = 1_000) => typeof value === "string" ? value.trim().slice(0, limit) : "";

function configFromEnv(env = process.env) {
  return {
    runtimePath: path.resolve(text(env.SEEDING_CAMOUFOX_RUNTIME_PATH) || DEFAULT_RUNTIME),
    executablePath: path.resolve(text(env.SEEDING_CAMOUFOX_EXECUTABLE_PATH) || DEFAULT_EXECUTABLE),
    runtimeMetadataPath: text(env.SEEDING_CAMOUFOX_RUNTIME_METADATA_PATH) ? path.resolve(text(env.SEEDING_CAMOUFOX_RUNTIME_METADATA_PATH)) : null,
    outputPath: text(env.CAMOUFOX_SMOKE_OUTPUT) ? path.resolve(text(env.CAMOUFOX_SMOKE_OUTPUT)) : null,
    timeoutMs: Math.max(1_000, Number(env.CAMOUFOX_SMOKE_TIMEOUT_MS) || 60_000)
  };
}

async function validateConfig(config) {
  const errors = [];
  try { await access(config.runtimePath); } catch { errors.push("runtime_path_unavailable"); }
  try { const info = await stat(config.executablePath); if (!info.isFile()) errors.push("executable_not_file"); }
  catch { errors.push("executable_unavailable"); }
  try { await readRuntimeMetadata(config.executablePath, config.runtimeMetadataPath); }
  catch (error) { errors.push(error.code || "runtime_metadata_unavailable"); }
  return errors;
}

function redactedResult(value) {
  const result = { ...value };
  delete result.profileRoot; delete result.profilePath;
  result.profileRootRedacted = "<temporary-disposable-profile>";
  return result;
}

export async function runCamoufoxSmoke({ env = process.env } = {}) {
  const config = configFromEnv(env);
  const startedAt = new Date().toISOString();
  const configErrors = await validateConfig(config);
  if (configErrors.length) return redactedResult({ status: "CONFIG_MISSING", startedAt, finishedAt: new Date().toISOString(), provider: "camoufox", configErrors });
  const profileRoot = await mkdtemp(path.join(os.tmpdir(), "marketing-seeding-camoufox-smoke-"));
  const profileReference = `smoke:${randomUUID()}`;
  const coordinator = new CamoufoxProfileCoordinator({ profileRoot, runtimePath: config.runtimePath, executablePath: config.executablePath, runtimeMetadataPath: config.runtimeMetadataPath, headless: true, launchTimeoutMs: config.timeoutMs });
  let lease; let protocol;
  const result = { status: "STARTING", startedAt, provider: "camoufox", platform: "smoke", accountId: "disposable-unauthenticated-smoke", profileReference };
  try {
    lease = await coordinator.acquire({ provider: "camoufox", platform: "smoke", accountId: "disposable-unauthenticated-smoke", profileReference, identityReference: "https://example.invalid/unauthenticated-smoke" });
    protocol = await coordinator.protocolFactory()({ profileReference, expectedIdentity: { provider: "camoufox", platform: "smoke", accountId: "disposable-unauthenticated-smoke", identityReference: "https://example.invalid/unauthenticated-smoke" }, runtimeIdentity: lease.handle.runtimeIdentity });
    const attached = await protocol.attach();
    const tabs = await protocol.listTabs();
    const evaluatedUrl = await protocol.evaluate(tabs[0].id, "location.href");
    Object.assign(result, { status: "PASS", leaseStatus: lease.status, attached, tabCount: tabs.length, evaluatedUrl, runtimeIdentity: lease.handle.runtimeIdentity, profileFingerprint: lease.handle.profileFingerprint });
  } catch (error) {
    Object.assign(result, { status: "FAIL", errorCode: text(error?.code, 120) || "CAMOUFOX_SMOKE_FAILED", error: text(error?.message, 240) });
  } finally {
    await protocol?.detach?.().catch(() => undefined);
    const released = lease ? await coordinator.release(lease.handle).catch((error) => ({ released: false, status: "RELEASE_ERROR", errorCode: text(error?.code, 120) || "RELEASE_ERROR" })) : { released: false, status: "NO_LEASE" };
    result.releaseStatus = released.status; result.finishedAt = new Date().toISOString();
    const metadata = await coordinator.readMetadata(profileReference).catch(() => null); result.metadataStatus = metadata?.status || null;
    await rm(profileRoot, { recursive: true, force: true });
  }
  return redactedResult(result);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runCamoufoxSmoke();
  if (process.env.CAMOUFOX_SMOKE_OUTPUT) await writeFile(path.resolve(process.env.CAMOUFOX_SMOKE_OUTPUT), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "PASS" ? 0 : result.status === "CONFIG_MISSING" ? 2 : 1;
}
