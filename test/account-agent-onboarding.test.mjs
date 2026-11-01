import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/store.mjs';
import { SeedingService } from '../src/service.mjs';
import { runCamoufoxAccountAgent } from '../src/camoufox-account-agent.mjs';

test('credential onboarding registers isolated agent and persists bounded login result', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'account-onboard-'));
  const store = new JsonStore(path.join(dir, 'state.json'));
  let runnerCalls = 0;
  const service = new SeedingService(store, { accountAgentRunner: async ({ account }) => { runnerCalls += 1; assert.equal(account.accountId, 'acct-1'); assert.equal(account.identityReference, null); return { status: 'READY', code: 'LOGIN_CONFIRMED', reason: 'exact identity observed', identityReference: 'https://www.linkedin.com/in/discovered-acct-1' }; } });
  await service.init();
  const result = await service.onboardExecutionAccount({ platform: 'linkedin', accountId: 'acct-1', profileId: 'profile-1', username: 'u', password: 'p', storeCredentials: async () => ({ credentialStored: true }) });
  assert.equal(runnerCalls, 1);
  assert.equal(result.login.status, 'READY');
  assert.equal(result.account.credentialStored, true);
  assert.equal(result.account.agentStatus, 'READY');
  assert.equal(result.account.identityReference, 'https://www.linkedin.com/in/discovered-acct-1');
  const state = await store.read();
  assert.equal(state.executionAccounts.length, 1);
  assert.equal(state.executionAccounts[0].health, 'healthy');
  assert.equal(JSON.stringify(state).includes('password'), false);
  assert.equal(JSON.stringify(state).includes('secret'), false);
});

test('credential onboarding isolates blocked account result', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'account-onboard-blocked-'));
  const store = new JsonStore(path.join(dir, 'state.json'));
  const service = new SeedingService(store, { accountAgentRunner: async () => ({ status: 'BLOCKED', code: 'ACCOUNT_SECURITY_CHALLENGE', reason: 'factor unavailable' }) });
  await service.init();
  const result = await service.onboardExecutionAccount({ platform: 'linkedin', accountId: 'acct-2', profileId: 'profile-2', identityReference: 'https://www.linkedin.com/in/acct-2', username: 'u', password: 'p', storeCredentials: async () => ({ credentialStored: true }) });
  assert.equal(result.login.status, 'BLOCKED');
  assert.equal(result.account.health, 'human_required');
  assert.equal(result.account.lastFailureCode, 'ACCOUNT_SECURITY_CHALLENGE');
});

test('credential onboarding runs the isolated Camoufox agent, derives identity and keeps credentials out of state', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'account-onboard-camoufox-'));
  const store = new JsonStore(path.join(dir, 'state.json'));
  const username = 'fixture-user@example.test';
  const password = 'fixture-password-never-persist';
  const fills = [];
  let released = false;
  let submitted = false;
  const protocol = {
    async listTabs() { return [{ pageId: 'page-1' }]; },
    async navigate(_pageId, url) { assert.match(url, /^https:\/\/www\.linkedin\.com\/login/); },
    async snapshot() { return submitted ? 'Home Feed Sign out' : 'Email Password Sign in'; },
    async resolve(_pageId, query) {
      const value = String(query);
      if (/password/i.test(value)) return 'password-ref';
      if (/sign|log|continue/i.test(value)) return 'submit-ref';
      return 'username-ref';
    },
    async fill(_pageId, ref, value) { fills.push({ ref, value }); },
    async click({ pageId, ref }) { assert.equal(pageId, 'page-1'); assert.equal(ref, 'submit-ref'); submitted = true; },
    async observeIdentity() {
      return {
        state: 'READY', provider: 'camoufox', platform: 'linkedin', accountId: 'acct-camoufox',
        providerProfileId: 'profile-camoufox', identityReference: 'https://www.linkedin.com/in/fixture-owner',
        evidence: { sessionAuthenticated: true, identityVerified: true, identitySource: 'linkedin-navigation-surface', candidateCount: 1 }
      };
    },
    async detach() { released = true; }
  };
  const resolver = {
    async acquire(request) {
      assert.equal(request.platform, 'linkedin');
      assert.equal(request.accountId, 'acct-camoufox');
      assert.equal(request.allowLoginBootstrap, true);
      return { ready: true, status: 'READY', handle: { profileReference: 'profile-camoufox' }, browserSurface: protocol, release: async () => { released = true; } };
    }
  };
  const service = new SeedingService(store, {
    accountAgentRunner: ({ account }) => runCamoufoxAccountAgent({
      account, resolver, readCredentials: async ({ accountId, platform }) => {
        assert.deepEqual({ accountId, platform }, { accountId: 'acct-camoufox', platform: 'linkedin' });
        return { username, password };
      }
    })
  });
  await service.init();
  const result = await service.onboardExecutionAccount({
    platform: 'linkedin', accountId: 'acct-camoufox', profileId: 'profile-camoufox',
    username, password, storeCredentials: async () => ({ credentialStored: true })
  });
  assert.equal(result.login.status, 'READY');
  assert.equal(result.account.agentStatus, 'READY');
  assert.equal(result.account.identityReference, 'https://www.linkedin.com/in/fixture-owner');
  assert.deepEqual(fills, [
    { ref: 'username-ref', value: username },
    { ref: 'password-ref', value: password }
  ]);
  assert.equal(released, true);
  const state = await store.read();
  const serialized = JSON.stringify(state);
  assert.equal(serialized.includes(username), false);
  assert.equal(serialized.includes(password), false);
  assert.equal(serialized.includes('password'), false);
  assert.equal(serialized.includes('fixture-password-never-persist'), false);
});
