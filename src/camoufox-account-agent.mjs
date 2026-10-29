import { loginAccountWithCamoufox } from './camoufox-account-login.mjs';

const MAX_REASON = 300;
const text = (v, n = MAX_REASON) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * Runs one isolated credential-backed account login. Credentials are read only
 * by loginAccountWithCamoufox and never enter the returned runtime projection.
 * Resolver/profile ownership is supplied by the host so each account owns a
 * distinct Camoufox profile lease.
 */
export async function runCamoufoxAccountAgent({ account, resolver, coordinator: directCoordinator = null, pageId = null, selectors = {}, onResult } = {}) {
  if (!account || typeof account !== 'object') return { status: 'BLOCKED', code: 'ACCOUNT_REQUIRED', reason: 'account metadata is required' };
  const platform = text(account.platform, 80).toLowerCase();
  const accountId = text(account.accountId, 160);
  if (!platform || !accountId) return { status: 'BLOCKED', code: 'ACCOUNT_BINDING_REQUIRED', reason: 'platform and accountId are required' };
  const coordinator = resolver?.coordinator || directCoordinator || null;
  if ((!resolver || typeof resolver.acquire !== 'function') && (!coordinator || typeof coordinator.acquire !== 'function')) return { status: 'UNKNOWN', code: 'CAMOUFOX_RESOLVER_UNAVAILABLE', reason: 'Camoufox session resolver is unavailable' };
  let acquired;
  let directProtocol;
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
      await directProtocol.attach?.();
    }
    const surface = acquired.browserSurface || acquired.handle.browserSurface || acquired.handle.transport?.browserSurface;
    const protocol = acquired.protocol || acquired.handle.protocol || surface || directProtocol;
    if (!protocol) return await finish({ status: 'UNKNOWN', code: 'CAMOUFOX_PROTOCOL_UNAVAILABLE', reason: 'Camoufox browser protocol is unavailable' });
    const tabs = typeof protocol.listTabs === 'function' ? await protocol.listTabs() : [];
    const selectedPage = pageId || tabs[0]?.pageId || tabs[0]?.id || 'page-1';
    const result = await loginAccountWithCamoufox({ platform, accountId, protocol, pageId: selectedPage, selectors, expectedIdentity: account.identityReference || account.expectedIdentityUrl || null });
    return await finish(result);
  } catch (error) {
    return await finish({ status: 'UNKNOWN', code: text(error?.code || 'CAMOUFOX_AGENT_ERROR', 80), reason: text(error?.message || 'Camoufox account agent failed') });
  } finally {
    try { await directProtocol?.detach?.(); } catch {}
    try { await acquired?.release?.(); } catch {}
    if (!resolver?.acquire && acquired?.handle) { try { await coordinator.release(acquired.handle); } catch {} }
  }
  async function finish(result) {
    const safe = { status: ['READY', 'BLOCKED', 'UNKNOWN'].includes(result?.status) ? result.status : 'UNKNOWN', code: text(result?.code || 'UNKNOWN', 80), reason: text(result?.reason || 'No bounded result') };
    if (result?.platform) safe.platform = text(result.platform, 80);
    if (result?.accountId) safe.accountId = text(result.accountId, 160);
    if (result?.identityReference) safe.identityReference = text(result.identityReference, 400);
    if (typeof onResult === 'function') await onResult(safe);
    return safe;
  }
}
