import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/store.mjs';
import { SeedingService } from '../src/service.mjs';

test('credential onboarding registers isolated agent and persists bounded login result', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'account-onboard-'));
  const store = new JsonStore(path.join(dir, 'state.json'));
  let runnerCalls = 0;
  const service = new SeedingService(store, { accountAgentRunner: async ({ account }) => { runnerCalls += 1; assert.equal(account.accountId, 'acct-1'); return { status: 'READY', code: 'LOGIN_CONFIRMED', reason: 'exact identity observed' }; } });
  await service.init();
  const result = await service.onboardExecutionAccount({ platform: 'linkedin', accountId: 'acct-1', profileId: 'profile-1', identityReference: 'https://www.linkedin.com/in/acct-1', username: 'u', password: 'p', storeCredentials: async () => ({ credentialStored: true }) });
  assert.equal(runnerCalls, 1);
  assert.equal(result.login.status, 'READY');
  assert.equal(result.account.credentialStored, true);
  assert.equal(result.account.agentStatus, 'READY');
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
