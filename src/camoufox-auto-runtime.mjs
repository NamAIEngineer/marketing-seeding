import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, constants as fsConstants, mkdir } from 'node:fs/promises';
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
async function executable(file) { try { await access(file, fsConstants.X_OK); return true; } catch { return false; } }

function managedPath(candidate, parent) {
  const resolvedCandidate = path.resolve(String(candidate || ''));
  const resolvedParent = path.resolve(String(parent || ''));
  const relative = path.relative(resolvedParent, resolvedCandidate);
  return relative === '' || (relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * Resolve and install the pinned browser through Camoufox's actual package
 * manager module. camoufox@0.5.8's public dist/index.js exports launcher APIs,
 * while ensureCamoufoxInstalled()/launchPath() live in dist/pkgman.js.
 * Running this probe in a child keeps the package's HOME-derived cache scoped
 * to the app runtime and avoids mutating the server process environment.
 */
async function provisionManagedBrowser({ root, cacheHome }) {
  const packageRoot = path.join(root, 'node_modules', 'camoufox');
  const indexFile = path.join(packageRoot, 'dist', 'index.js');
  const packageManagerFile = path.join(packageRoot, 'dist', 'pkgman.js');
  const script = `
import { access, constants, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = ${JSON.stringify(root)};
const cacheHome = ${JSON.stringify(cacheHome)};
const within = (candidate, parent) => {
  const child = path.resolve(String(candidate || ''));
  const base = path.resolve(String(parent || ''));
  const relative = path.relative(base, child);
  return relative === '' || (relative && !relative.startsWith( '..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};
const publicApi = await import(${JSON.stringify(pathToFileURL(indexFile).href)});
let managerApi = publicApi;
if (typeof managerApi.ensureCamoufoxInstalled !== 'function' || typeof managerApi.launchPath !== 'function') {
  managerApi = await import(${JSON.stringify(pathToFileURL(packageManagerFile).href)});
}
if (typeof managerApi.ensureCamoufoxInstalled !== 'function' || typeof managerApi.launchPath !== 'function') {
  throw Object.assign(new Error('Camoufox package manager API is unavailable'), { code: 'CAMOUFOX_API_UNAVAILABLE' });
}
const browserPath = await managerApi.ensureCamoufoxInstalled();
const executablePath = managerApi.launchPath(browserPath);
if (!within(browserPath, cacheHome) || !within(executablePath, browserPath)) {
  throw Object.assign(new Error('Camoufox browser resolved outside managed cache'), { code: 'CAMOUFOX_BROWSER_PATH_UNMANAGED' });
}
const executableStat = await stat(executablePath);
await access(executablePath, constants.X_OK);
if (!executableStat.isFile()) throw Object.assign(new Error('Camoufox executable is not a file'), { code: 'CAMOUFOX_EXECUTABLE_INVALID' });
process.stdout.write(JSON.stringify({ browserPath, executablePath, cacheRoot: cacheHome }));
`;
  const env = {
    ...process.env,
    HOME: cacheHome,
    XDG_CACHE_HOME: path.join(cacheHome, '.cache'),
    CAMOUFOX_HOME: cacheHome
  };
  try {
    const result = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], { env, timeout: 180_000, windowsHide: true, maxBuffer: 64 * 1024 });
    let payload;
    try { payload = JSON.parse(String(result.stdout || '').trim()); } catch { throw Object.assign(new Error('Camoufox provisioning returned invalid metadata'), { code: 'CAMOUFOX_PROVISION_OUTPUT_INVALID' }); }
    if (!payload?.browserPath || !payload?.executablePath || !managedPath(payload.browserPath, cacheHome) || !managedPath(payload.executablePath, payload.browserPath) || !await executable(payload.executablePath)) {
      throw Object.assign(new Error('Camoufox provisioning returned an invalid executable'), { code: 'CAMOUFOX_EXECUTABLE_INVALID' });
    }
    return Object.freeze(payload);
  } catch (error) {
    if (error?.code && String(error.code).startsWith('CAMOUFOX_')) throw error;
    throw Object.assign(new Error('Camoufox browser installation failed'), { code: 'CAMOUFOX_BROWSER_INSTALL_FAILED', cause: error });
  }
}

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
      const cacheHome = path.join(root, '.camoufox-home');
      await mkdir(cacheHome, { recursive: true, mode: 0o700 });
      const packageEntry = path.join(root, 'node_modules', 'camoufox', 'dist', 'index.js');
      if (!await exists(packageEntry)) {
        const npm = text(npmBin, 1_000) || process.env.SEEDING_NPM_BIN || 'npm';
        try {
          await execFileAsync(npm, ['install', '--prefix', root, '--no-save', '--ignore-scripts', `camoufox@${PINNED_CAMOUFOX}`, `playwright-core@${PINNED_PLAYWRIGHT}`], {
            env: { ...process.env, HOME: cacheHome, XDG_CACHE_HOME: path.join(cacheHome, '.cache'), NPM_CONFIG_CACHE: path.join(cacheHome, 'npm-cache') },
            timeout: 180_000,
            windowsHide: true
          });
        } catch (error) {
          throw Object.assign(new Error('Camoufox package installation failed'), { code: 'CAMOUFOX_PACKAGE_INSTALL_FAILED', cause: error });
        }
      }
      const { browserPath: installedPath, executablePath } = await provisionManagedBrowser({ root, cacheHome });
      const coordinator = new CamoufoxProfileCoordinator({ profileRoot: profiles, runtimePath: root, executablePath, headless });
      return Object.freeze({ coordinator, executablePath, packageVersion: PINNED_CAMOUFOX, browserPath: installedPath, cacheRoot: cacheHome });
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
