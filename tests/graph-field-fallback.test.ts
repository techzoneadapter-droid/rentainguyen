import test from 'node:test';
import assert from 'node:assert/strict';
import { AD_ACCOUNT_FIELD_VARIANTS, readWithFieldFallback } from '../lib/graph-field-fallback.ts';

test('billing permission failure still allows a minimal status response', async () => {
  const calls: string[] = [];
  const result = await readWithFieldFallback(AD_ACCOUNT_FIELD_VARIANTS, async (fields) => {
    calls.push(fields);
    if (fields.includes('balance')) throw new Error('field permission');
    return { id: '123456', account_status: 1 };
  }, () => true);
  assert.equal(result.account_status, 1);
  assert.equal(calls.length, 2);
});

test('unavailable status falls back to identity without inventing delivery', async () => {
  const result = await readWithFieldFallback(AD_ACCOUNT_FIELD_VARIANTS, async (fields) => {
    if (fields.includes('account_status')) throw new Error('field permission');
    return { id: '123456', name: 'Account' };
  }, () => true);
  assert.deepEqual(result, { id: '123456', name: 'Account' });
  assert.equal('account_status' in result, false);
});

test('rate limits and credential errors stop field retries', async () => {
  let calls = 0;
  const failure = new Error('rate limited');
  await assert.rejects(readWithFieldFallback(AD_ACCOUNT_FIELD_VARIANTS, async () => {
    calls++;
    throw failure;
  }, () => false), failure);
  assert.equal(calls, 1);
});
