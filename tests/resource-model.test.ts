import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateCurrencies,
  bmClassification,
  mergeDiscoveredAssets,
  resolveAccountAvailability,
  runIndependentBatch,
  shopIdempotencyKey,
  shopPushDisposition,
  shopValidationErrors,
} from '../lib/resource-model.ts';
import { MetaCreationError, toStructuredMetaError } from '../lib/meta-errors.ts';
import type { Asset } from '../lib/data.ts';

function bm(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'owner:meta:123456789', metaId: '123456789', name: 'BM Test', type: 'BM', status: 'LIVE', verified: false,
    country: 'VN', tier: 'BM5', limit: '5', bmType: 'BM5', accountCapacity: 5, adAccountCount: 2,
    currencies: ['USD'], currencyMode: 'SINGLE', currency: 'USD', parent: '', source: 'meta',
    accessLinkStatus: 'ready', accessLink: 'https://handoff.example/invite/abc', shopStatus: 'ready',
    ...overrides,
  } as Asset;
}

test('Graph Page 1 + Session Page 5 gives 5 unique Pages', () => {
  const rows = [
    { id: '10001', name: 'Graph', sources: ['graph_accounts' as const] },
    ...Array.from({ length: 5 }, (_, index) => ({ id: String(10001 + index), name: `Session ${index + 1}`, sources: ['session' as const] })),
  ];
  const merged = mergeDiscoveredAssets(rows);
  assert.equal(merged.length, 5);
  assert.deepEqual(merged[0].sources.sort(), ['graph_accounts', 'session']);
});

test('owned_pages + client_pages duplicate is deduplicated by Page ID', () => {
  const merged = mergeDiscoveredAssets([
    { id: '20001', name: 'Page', sources: ['bm_owned' as const] },
    { id: '20001', name: 'Page', sources: ['bm_client' as const] },
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sources.sort(), ['bm_client', 'bm_owned']);
});

test('deduplication keeps rich metadata and all owning business ids', () => {
  const merged = mergeDiscoveredAssets([
    {
      id: '30001', name: 'Primary Ads', amountSpent: '1200', balance: '300', currency: 'USD',
      businessIds: ['90001'], sources: ['graph_accounts' as const],
    },
    {
      id: '30001', name: 'Ads 30001', amountSpent: undefined, balance: undefined,
      businessIds: ['90002'], sources: ['bm_client' as const],
    },
  ]);
  assert.equal(merged[0].name, 'Primary Ads');
  assert.equal(merged[0].amountSpent, '1200');
  assert.equal(merged[0].balance, '300');
  assert.deepEqual(merged[0].businessIds.sort(), ['90001', '90002']);
});

test('Graph failure + live Session keeps account LIVE', () => {
  assert.deepEqual(resolveAccountAvailability(false, true), { live: true, source: 'cookie' });
});

test('BM create Graph failure + Session failure retains both diagnostics', () => {
  const error = new MetaCreationError([
    toStructuredMetaError({ message: 'Graph denied', code: 200 }, { source: 'graph', stage: 'graph_create' }),
    toStructuredMetaError({ body: { errors: [{ message: 'Session denied' }] }, message: 'Session denied' }, { source: 'session', stage: 'session_create' }),
  ]);
  assert.equal(error.errors.length, 2);
  assert.deepEqual(error.errors.map((item) => item.stage), ['graph_create', 'session_create']);
});

test('BM type uses only owned ad accounts, not capacity or total linked accounts', () => {
  assert.deepEqual(bmClassification(50, 7, 2, 2), {
    bmType: 'BM2',
    accountCapacity: 50,
    adAccountCount: 7,
    ownedAdAccountCount: 2,
  });
});

test('partial owned-account discovery is marked as a lower bound', () => {
  assert.deepEqual(bmClassification(null, 7, null, 2), {
    bmType: 'BM2+',
    accountCapacity: null,
    adAccountCount: 7,
    ownedAdAccountCount: null,
  });
});

test('three USD accounts aggregate to USD SINGLE', () => {
  assert.deepEqual(aggregateCurrencies(['USD', 'USD', 'USD']), { currencies: ['USD'], currencyMode: 'SINGLE', currency: 'USD' });
});

test('USD + VND aggregate to MULTI', () => {
  assert.deepEqual(aggregateCurrencies(['USD', 'VND']), { currencies: ['USD', 'VND'], currencyMode: 'MULTI', currency: 'MULTI' });
});

test('link ready BM passes Shop validation', () => {
  assert.deepEqual(shopValidationErrors(bm()), []);
});

test('link failed BM is rejected by Shop validation', () => {
  assert.match(shopValidationErrors(bm({ accessLinkStatus: 'failed', accessLink: '' })).join(' '), /accessLinkStatus/);
});

test('ADS and Page are rejected by Shop validation', () => {
  assert.match(shopValidationErrors(bm({ type: 'TKQC' }))[0], /chỉ BM/);
  assert.match(shopValidationErrors(bm({ type: 'Page' }))[0], /chỉ BM/);
});

test('pushing the same BM twice uses a stable idempotency decision', () => {
  const pushed = bm({ shopStatus: 'pushed', shopProductId: 'product-1' });
  assert.equal(shopIdempotencyKey(pushed), 'owner:meta:123456789');
  assert.equal(shopPushDisposition(pushed), 'idempotent');
  assert.equal(shopPushDisposition({ ...pushed }), 'idempotent');
});

test('batch link generation continues after one failure', async () => {
  const results = await runIndependentBatch([1, 2, 3], async (value) => {
    if (value === 2) throw new Error('failed');
    return value * 10;
  }, { continueOnError: true, maxConsecutiveErrors: 3 });
  assert.equal(results.length, 3);
  assert.deepEqual(results.map((item) => item.ok), [true, false, true]);
});
