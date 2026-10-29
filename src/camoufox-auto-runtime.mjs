import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CamoufoxProfileCoordinator } from './camoufox-profile-coordinator.mjs';
import { runCamoufoxAccountAgent } from './camoufox-account-agent.mjs';
import { CamoufoxExecutionSessionResolver } from './camoufox-execution-session-resolver.mjs';
import { createAccountRuntimeRegistry } from './account-runtime-registry.mjs';

const execFileAsync = promisify(execFile);
const PINNED_CAMOUFOX = '0.5.8';
const PINNED_PLAYWRIGHT = '1.62.0';
const text = (v, n = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

async function exists(file) { try { await access(file); return true; } catch { return false; } }

/** Lazy, local-first Camoufox provisioning. No credentials or provider keys are
 * touched. Package/browser downloads are integrity checked by npm/Camoufox. */
export function createAutoCamoufoxAccountAgentRunner({ dataRoot, runtimeRoot, profileRoot, npmBin = '', headless = true } = {}) {
  const root = path.resolve(String(runtimeRoot || path.join(dataRoot || process.cwd(), 'camoufox-runtime')));
  const profiles = path.resolve(String(profileRoot || path.join(dataRoot || process.cwd(), 'camoufox-profiles')));
  const provision = createAutoCamoufoxProvisioner({ root, profiles, npmBin, headless });
  const runner = async ({ account } = {}) => {
    try {
      const runtime = await provision();
      return await runCamoufoxAccountAgent({ account, coordinator: runtime.coordinator });
    } catch (error) {
      return { status: 'UNKNOWN', code: text(error?.code || 'CAMOUFOX_PROVISION_FAILED', 80), reason: text(error?.message || 'Camoufox provisioning failed') };
    }
  };
  runner.provision = provision;
  return runner;
}

export function createAutoCamoufoxProvisioner({ root, profiles, npmBin = '', headless = true } = {}) {
  let ready = null;
  return async function provision() {
    if (ready) return ready;
    ready = (async () => {
      await mkdir(root, { recursive: true, mode: 0o700 });
      await mkdir(profiles, { recursive: true, mode: 0o700 });
      const packageEntry = path.join(root, 'node_modules', 'camoufox', 'dist', 'index.js');
      if (!await exists(packageEntry)) {
        const npm = text(npmBin, 1_000) || process.env.SEEDING_NPM_BIN || 'npm';
        await execFileAsync(npm, ['install', '--prefix', root, '--no-save', '--ignore-scripts', `camoufox@${PINNED_CAMOUFOX}`, `playwright-core@${PINNED_PLAYWRIGHT}`], { timeout: 180_000, windowsHide: true });
      }
      const camoufox = await import(pathToFileURL(packageEntry).href);
      const installedPath = await camoufox.ensureCamoufoxInstalled();
      const executablePath = camoufox.launchPath(installedPath);
      if (!await exists(executablePath)) throw Object.assign(new Error('Camoufox executable was not installed'), { code: 'CAMOUFOX_EXECUTABLE_MISSING' });
      const coordinator = new CamoufoxProfileCoordinator({ profileRoot: profiles, runtimePath: root, executablePath, headless });
      return Object.freeze({ coordinator, executablePath, packageVersion: PINNED_CAMOUFOX, browserPath: installedPath });
    })().catch((error) => { ready = null; throw error; });
    return ready;
  };
}

/**
 * Build the default execution resolver from canonical local account state.
 * The resolver is intentionally lazy: a clean install can start the Overview
 * without Camoufox or npm, while a live execution provisions the pinned
 * runtime and then selects the exact account/profile requested by JEV.
 * `stateReader` must return canonical state; only sanitized account metadata
 * is copied into the resolver registry. Credentials never cross this seam.
 */
export function createAutoCamoufoxExecutionSessionResolver({ dataRoot, runtimeRoot, profileRoot, npmBin = '', headless = true, stateReader, provisionRuntime = null } = {}) {
  const root = path.resolve(String(runtimeRoot || path.join(dataRoot || process.cwd(), 'camoufox-runtime')));
  const profiles = path.resolve(String(profileRoot || path.join(dataRoot || process.cwd(), 'camoufox-profiles')));
  const provision = typeof provisionRuntime === 'function' ? provisionRuntime : createAutoCamoufoxProvisioner({ root, profiles, npmBin, headless });
  const readState = typeof stateReader === 'function' ? stateReader : async () => ({ executionAccounts: [] });
  return {
    provider: 'camoufox',
    runtimeProvider: 'camoufox',
    async acquire(request = {}) {
      const runtime = await provision();
      const state = await readState();
      const accountRows = (state?.executionAccounts || []).map((account) => ({
        platform: account.platform,
        accountId: account.accountId,
        provider: 'camoufox',
        profileRef: account.providerProfileId || account.profileId,
        providerProfileId: account.providerProfileId || account.profileId,
        identityReference: account.identityReference || account.expectedIdentityUrl || null,
        sessionHealth: account.sessionHealth || (account.health === 'healthy' ? 'healthy' : 'unknown'),
        permissions: account.permissions || {},
        allowedCampaigns: account.allowedCampaigns || [],
        allowedTargets: account.allowedTargets || [],
        quota: account.quota || {},
        cadence: account.cadence || {},
        cooldown: account.cooldown || {},
        risk: account.risk || 'normal',
        lastHealthCheck: account.lastReadinessAt || null
      })).filter((account) => account.platform && account.accountId && account.profileRef);
      const registry = createAccountRuntimeRegistry(accountRows);
      const hostAttestation = {
        host: 'localhost', runtime: 'camoufox', version: runtime.packageVersion,
        evidence: 'app-local-camoufox-runtime', observedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
      };
      const resolver = new CamoufoxExecutionSessionResolver({
        accountRegistry: registry,
        coordinator: runtime.coordinator,
        protocolFactory: runtime.coordinator.protocolFactory(),
        hostAttestation,
        sessionAuthorityReference: 'app:marketing-seeding:camoufox',
        profileReference: ''
      });
      return resolver.acquire({ ...request, provider: 'camoufox' });
    },
    resolve(request = {}) { return this.acquire(request); }
  };

}

export const CAMOUFOX_PINNED_VERSION = PINNED_CAMOUFOX;
export const PLAYWRIGHT_PINNED_VERSION = PINNED_PLAYWRIGHT;
