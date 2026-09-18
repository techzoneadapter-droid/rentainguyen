import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMixedInput } from '../lib/mixed-credentials.ts';

test('cookie-only line is accepted and stores uid from c_user', () => {
  const rows = parseMixedInput('c_user=61551018656125; xs=12:abc; datr=zzz');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].uid, '61551018656125');
  assert.ok(rows[0].cookie?.includes('c_user='));
  assert.equal(rows[0].token, undefined);
});

test('uid|cookie without token is accepted', () => {
  const rows = parseMixedInput('61551018656125|c_user=61551018656125; xs=aa; datr=bb');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].uid, '61551018656125');
  assert.equal(rows[0].token, undefined);
});

test('token-only EAA line is accepted', () => {
  const rows = parseMixedInput('EAAB' + 'x'.repeat(30));
  assert.equal(rows.length, 1);
  assert.ok(rows[0].token?.startsWith('EAAB'));
  assert.equal(rows[0].cookie, undefined);
});

test('uid|cookie|token stays one account', () => {
  const token = 'EAAC' + 'y'.repeat(28);
  const rows = parseMixedInput(`10001|c_user=10001; xs=1; datr=2|${token}`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].uid, '10001');
  assert.equal(rows[0].token, token);
  assert.ok(rows[0].cookie);
});

test('cookie line then token line merge into one account', () => {
  const token = 'EAAD' + 'z'.repeat(28);
  const rows = parseMixedInput(`c_user=10006704667781; xs=qq; fr=ww\n${token}`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].uid, '10006704667781');
  assert.equal(rows[0].token, token);
});

test('Get Cookie extension JSON array of name/value pairs', () => {
  const rows = parseMixedInput(JSON.stringify([
    { name: 'c_user', value: '61594176005919' },
    { name: 'xs', value: 'sessionvalue' },
    { name: 'datr', value: 'device' },
  ]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].uid, '61594176005919');
  assert.ok(rows[0].cookie?.includes('xs=sessionvalue'));
});
