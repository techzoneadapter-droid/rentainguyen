import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, redactSecretsDeep } from '../lib/redact.ts';

// ===== Bắt buộc #51: redactSecrets che credential =====

test('access_token query value is redacted', () => {
  const out = redactSecrets('GET https://graph.facebook.com/v26.0/me?access_token=EAABsupersecret123456');
  assert.ok(!out.includes('EAABsupersecret123456'));
  assert.ok(out.includes('[REDACTED]'));
});

test('Bearer authorization header is redacted', () => {
  const out = redactSecrets('Authorization: Bearer EAACdefghijklmnopqrst');
  assert.ok(!out.includes('EAACdefghijklmnopqrst'));
});

test('raw EA token is redacted even without a label', () => {
  const out = redactSecrets('token leaked: EAAxxxxxxxxxxxxxxxxxxxx');
  assert.ok(!out.includes('EAAxxxxxxxxxxxxxxxxxxxx'));
});

test('fb_dtsg and cookie pairs are redacted', () => {
  const out = redactSecrets('fb_dtsg="AbCdEf123456:"; c_user=1000123456789; xs=48; datr=abcDEF123; fr=xyz');
  assert.ok(!out.includes('AbCdEf123456'));
  assert.ok(!out.includes('1000123456789'));
  assert.ok(!out.includes('48'));
  assert.ok(out.includes('[REDACTED]'));
});

test('normal text and Meta IDs survive redaction', () => {
  const text = 'Meta 656931087344178 trả HTTP 400: field funding_source không hỗ trợ.';
  assert.equal(redactSecrets(text), text);
});

test('redactSecretsDeep redacts token/cookie keys recursively', () => {
  const out = redactSecretsDeep({
    name: 'BM test',
    token: 'EAAsecrettokenvalue123',
    nested: { cookieHeader: 'xs=1; datr=2', note: 'safe' },
    list: [{ accessToken: 'EAAanothertoken456' }],
  }) as Record<string, unknown>;
  assert.equal(out.name, 'BM test');
  assert.equal(out.token, '[REDACTED]');
  const nested = out.nested as Record<string, unknown>;
  assert.equal(nested.cookieHeader, '[REDACTED]');
  assert.equal(nested.note, 'safe');
  assert.equal((out.list as Array<Record<string, unknown>>)[0].accessToken, '[REDACTED]');
});
