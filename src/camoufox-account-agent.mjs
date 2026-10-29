import { loginAccountWithCamoufox } from './camoufox-account-login.mjs';
import { loginAccountWithCamoufoxPlatform, getCamoufoxPlatformLoginAdapter } from './camoufox-platform-login-adapters.mjs';
import { readAccountCredentials } from './account-credentials.mjs';

const MAX_REASON = 300;
const text = (v, n = MAX_REASON) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * Runs one isolated credential-backed account login. Credentials are read only
 * by loginAccountWithCamoufox and never enter the returned runtime projection.
 * Resolver/profile ownership is supplied by the host so each account owns a
 * distinct Camoufox profile lease.
 */
export async function runCamoufoxAccountAgent({ account, resolver, coordinator: directCoordinator = null, pageId = null, selectors = {}, target = null, readCredentials = null, onResult } = {}) {
  if (!account || typeof account !== 'object') return { status: 'BLOCKED', code: 'ACCOUNT_REQUIRED', reason: 'account metadata is required' };
  const platform = text(account.platform, 80).toLowerCase();
  const accountId = text(account.accountId, 160);
  if (!platform || !accountId) return { status: 'BLOCKED', code: 'ACCOUNT_BINDING_REQUIRED', reason: 'platform and accountId are required' };
  const coordinator = resolver?.coordinator || directCoordinator || null;
  if ((!resolver || typeof resolver.acquire !== 'function') && (!coordinator || typeof coordinator.acquire !== 'function')) return { status: 'UNKNOWN', code: 'CAMOUFOX_RESOLVER_UNAVAILABLE', reason: 'Camoufox session resolver is unavailable' };
  let acquired;
  let directProtocol;
  let credentials = null;
  try {
    const request = {
      provider: 'camoufox', platform, accountId,
      allowIdentityDiscovery: true,
      allowLoginBootstrap: true,
      providerProfileId: account.providerProfileId || account.profileId || account.profileRef,
      profileReference: account.providerProfileId || account.profileId || account.profileRef,
      ...(account.identityReference || account.expectedIdentityUrl ? { identityReference: account.identityReference || account.expectedIdentityUrl } : {})
    };
    acquired = resolver?.acquire ? await resolver.acquire(request) : await coordinator.acquire(request);
    if (!acquired?.ready || !acquired.handle) {
      return await finish({ status: acquired?.status === 'BLOCKED' ? 'BLOCKED' : 'UNKNOWN', code: acquired?.code || 'CAMOUFOX_SESSION_UNAVAILABLE', reason: acquired?.reason || 'Camoufox session could not be acquired' });
    }
    if (!resolver?.acquire) {
      directProtocol = await coordinator.protocolFactory()({ profileReference: acquired.handle.profileReference, expectedIdentity: { provider: 'camoufox', platform, accountId, ...(account.identityReference || account.expectedIdentityUrl ? { identityReference: account.identityReference || account.expectedIdentityUrl } : {}) }, runtimeIdentity: acquired.handle.runtimeIdentity });
      await directProtocol.attach?.({ allowUnauthenticated: true });
    }
    const surface = acquired.browserSurface || acquired.handle.browserSurface || acquired.handle.transport?.browserSurface;
    const protocol = acquired.protocol || acquired.handle.protocol || surface || directProtocol;
    if (!protocol) return await finish({ status: 'UNKNOWN', code: 'CAMOUFOX_PROTOCOL_UNAVAILABLE', reason: 'Camoufox browser protocol is unavailable' });
    const tabs = typeof protocol.listTabs === 'function' ? await protocol.listTabs() : [];
    const selectedPage = pageId || tabs[0]?.pageId || tabs[0]?.id || 'page-1';
    const expectedIdentity = account.identityReference || account.expectedIdentityUrl || null;
    const credentialReader = typeof readCredentials === 'function' ? readCredentials : readAccountCredentials;
    let result;
    if (platform === 'linkedin') {
      // Keychain is the production reader; tests/host fixtures may inject a
      // bounded reader. Credentials are passed only to the login call.
      credentials = await credentialReader({ accountId, platform });
      result = await loginAccountWithCamoufox({ platform, accountId, protocol, pageId: selectedPage, selectors, expectedIdentity, credentials });
    } else if (getCamoufoxPlatformLoginAdapter(platform)) {
      // Credentials remain in memory for this bounded call only. They never
      // enter account state, logs, process argv, or the returned projection.
      credentials = await credentialReader({ accountId, platform });
      result = await loginAccountWithCamoufoxPlatform({
        platform, accountId, protocol, pageId: selectedPage,
        expectedIdentity, allowIdentityDiscovery: true, target, credentials
      });
    } else {
      result = { status: 'BLOCKED', code: 'PLATFORM_LOGIN_UNSUPPORTED', reason: 'no bounded Camoufox login adapter is implemented for this platform' };
    }
    return await finish(result);
  } catch (error) {
    return await finish({ status: 'UNKNOWN', code: text(error?.code || 'CAMOUFOX_AGENT_ERROR', 80), reason: text(error?.message || 'Camoufox account agent failed') });
  } finally {
    // Drop the local reference as soon as the bounded login attempt completes.
    credentials = null;
    try { await directProtocol?.detach?.(); } catch {}
    try { await acquired?.release?.(); } catch {}
    if (!resolver?.acquire && acquired?.handle) { try { await coordinator.release(acquired.handle); } catch {} }
  }
  async function finish(result) {
    const safe = { status: ['READY', 'BLOCKED', 'UNKNOWN'].includes(result?.status) ? result.status : 'UNKNOWN', code: text(result?.code || 'UNKNOWN', 80), reason: text(result?.reason || 'No bounded result') };
    if (result?.platform) safe.platform = text(result.platform, 80);
    if (result?.accountId) safe.accountId = text(result.accountId, 160);
    if (result?.identityReference) safe.identityReference = text(result.identityReference, 400);
    if (typeof result?.identityVerified === 'boolean') safe.identityVerified = result.identityVerified;
    if (typeof result?.authenticated === 'boolean') safe.authenticated = result.authenticated;
    if (result?.postingRights && typeof result.postingRights === 'object') {
      safe.postingRights = {
        status: ['READY', 'BLOCKED', 'UNKNOWN', 'NOT_CHECKED'].includes(String(result.postingRights.status)) ? String(result.postingRights.status) : 'UNKNOWN',
        targetId: text(result.postingRights.targetId, 160) || null,
        reason: text(result.postingRights.reason, 180) || null,
        evidence: result.postingRights.evidence && typeof result.postingRights.evidence === 'object' ? {
          targetMatched: result.postingRights.evidence.targetMatched === true,
          canPost: result.postingRights.evidence.canPost === true,
          authenticatedSurface: result.postingRights.evidence.authenticatedSurface === true,
          membershipRequired: result.postingRights.evidence.membershipRequired === true,
          rightsDeclared: result.postingRights.evidence.rightsDeclared === true,
          membershipStatus: text(result.postingRights.evidence.membershipStatus, 80) || null,
          postingStatus: text(result.postingRights.evidence.postingStatus, 80) || null,
          composerVisible: result.postingRights.evidence.composerVisible === true,
          submitControlVisible: result.postingRights.evidence.submitControlVisible === true,
          submitControlEnabled: result.postingRights.evidence.submitControlEnabled === true
        } : null
      };
    }
    if (result?.evidence && typeof result.evidence === 'object') {
      safe.loginEvidence = {
        loginUrl: text(result.evidence.loginUrl, 400) || null,
        challengeDetected: result.evidence.challengeDetected === true,
        loginControlsObserved: result.evidence.loginControlsObserved === true,
        identitySource: text(result.evidence.identitySource, 120) || null,
        identityConfidence: Number.isFinite(Number(result.evidence.identityConfidence)) ? Number(result.evidence.identityConfidence) : 0,
        identityAmbiguous: result.evidence.identityAmbiguous === true,
        candidateCount: Number.isFinite(Number(result.evidence.candidateCount)) ? Number(result.evidence.candidateCount) : null,
        authenticatedSurface: result.evidence.authenticatedSurface === true,
        ownerSurface: result.evidence.ownerSurface === true,
        stableIdentityId: text(result.evidence.stableIdentityId, 160) || null
      };
    }
    if (typeof onResult === 'function') await onResult(safe);
    return safe;
  }
}
