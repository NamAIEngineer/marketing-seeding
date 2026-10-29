import { readFile } from "node:fs/promises";
import path from "node:path";
import { createAccountRuntimeRegistry } from "./account-runtime-registry.mjs";
import { CamoufoxExecutionSessionResolver } from "./camoufox-execution-session-resolver.mjs";
import { CamoufoxProfileCoordinator } from "./camoufox-profile-coordinator.mjs";
import { mutationExpressionHash } from "./browser-mutation-policy.mjs";
import { linkedInReadinessMutationExpressions } from "./linkedin-readiness.mjs";

const text = (value, limit = 400) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const requiredPath = (value, name) => {
  const resolved = text(value, 1_000);
  if (!resolved) throw Object.assign(new Error(`${name} is required`), { code: "CAMOUFOX_CONFIG_REQUIRED" });
  return path.resolve(resolved);
};

async function readRegistry(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw Object.assign(new Error("Camoufox account registry is unavailable"), { code: error.code === "ENOENT" ? "CAMOUFOX_ACCOUNT_REGISTRY_UNAVAILABLE" : "CAMOUFOX_ACCOUNT_REGISTRY_INVALID" });
  }
  const accounts = Array.isArray(parsed) ? parsed : parsed?.accounts;
  if (!Array.isArray(accounts)) throw Object.assign(new Error("Camoufox account registry must contain an accounts array"), { code: "CAMOUFOX_ACCOUNT_REGISTRY_INVALID" });
  return createAccountRuntimeRegistry(accounts);
}

/**
 * Explicit server-side Camoufox resolver factory.
 *
 * Configuration contains only runtime paths, sanitized account metadata and a
 * non-secret authority reference. Credentials and raw session material never
 * enter this module. Ordinary authentication remains a separate account
 * runtime capability and an unresolved session stays fail-closed.
 */
export async function createExecutionSessionResolver({ provider, profileReference, sessionAuthority, hostAttestation } = {}) {
  if (String(provider || "").toLowerCase() !== "camoufox") {
    throw Object.assign(new Error("Camoufox resolver requires provider=camoufox"), { code: "CAMOUFOX_PROVIDER_REQUIRED" });
  }
  if (!text(sessionAuthority, 240)) throw Object.assign(new Error("Camoufox session authority is required"), { code: "CAMOUFOX_SESSION_AUTHORITY_REQUIRED" });
  const env = process.env;
  const accountRegistryPath = requiredPath(env.SEEDING_CAMOUFOX_ACCOUNT_REGISTRY_FILE, "SEEDING_CAMOUFOX_ACCOUNT_REGISTRY_FILE");
  const profileRoot = requiredPath(env.SEEDING_CAMOUFOX_PROFILE_ROOT, "SEEDING_CAMOUFOX_PROFILE_ROOT");
  const runtimePath = requiredPath(env.SEEDING_CAMOUFOX_RUNTIME_PATH, "SEEDING_CAMOUFOX_RUNTIME_PATH");
  const executablePath = requiredPath(env.SEEDING_CAMOUFOX_EXECUTABLE_PATH, "SEEDING_CAMOUFOX_EXECUTABLE_PATH");
  const accountRegistry = await readRegistry(accountRegistryPath);
  const coordinator = new CamoufoxProfileCoordinator({
    profileRoot,
    runtimePath,
    executablePath,
    runtimeMetadataPath: text(env.SEEDING_CAMOUFOX_RUNTIME_METADATA_PATH, 1_000) || null,
    headless: env.SEEDING_CAMOUFOX_HEADLESS !== "false"
  });
  const mutationExpressionHashes = {
    LINKEDIN_COMPOSER_TRIGGER: [mutationExpressionHash(linkedInReadinessMutationExpressions.composerTrigger)],
    LINKEDIN_COMPOSER_CLOSE: [mutationExpressionHash(linkedInReadinessMutationExpressions.composerClose)]
  };
  return new CamoufoxExecutionSessionResolver({
    accountRegistry,
    coordinator,
    protocolFactory: coordinator.protocolFactory({ mutationExpressionHashes }),
    sessionMetadataPath: text(env.SEEDING_CAMOUFOX_SESSION_METADATA_FILE, 2_000) || null,
    hostAttestation,
    profileReference: text(profileReference, 180),
    sessionAuthorityReference: text(sessionAuthority, 240)
  });
}

export default createExecutionSessionResolver;
