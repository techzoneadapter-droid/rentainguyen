import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adBucket,
  adBucketFromStatus,
  classifyAdDelivery,
  readSourceFromSources,
  resolveAdDelivery,
  resolveAdAccess,
  summarizeAdAssets,
  summarizeAdBuckets,
} from '../lib/ad-status.ts';

// ===== Bắt buộc #48: phân loại trạng thái TKQC =====

test('account_status=1 maps to LIVE', () => {
  const result = classifyAdDelivery(1);
  assert.equal(result.deliveryStatus, 'LIVE');
  assert.equal(result.bucket, 'live');
});

test('known disabled statuses (2, 101) map to DISABLED/die', () => {
  assert.equal(classifyAdDelivery(2).deliveryStatus, 'DISABLED');
  assert.equal(classifyAdDelivery(2).bucket, 'die');
  assert.equal(classifyAdDelivery(101).deliveryStatus, 'DISABLED');
  assert.equal(classifyAdDelivery(101).bucket, 'die');
});

test('account_status missing is UNKNOWN, never restricted', () => {
  for (const missing of [undefined, null, '']) {
    const result = classifyAdDelivery(missing);
    assert.equal(result.deliveryStatus, 'UNKNOWN');
    assert.equal(result.bucket, 'unknown');
  }
  assert.equal(adBucket(undefined), 'unknown');
});

test('non-numeric status string is UNKNOWN, not restricted', () => {
  const result = classifyAdDelivery('disabled');
  assert.equal(result.deliveryStatus, 'UNKNOWN');
  assert.equal(result.bucket, 'unknown');
});

test('unknown raw Meta status keeps rawAccountStatus and stays UNKNOWN', () => {
  const result = classifyAdDelivery(999);
  assert.equal(result.deliveryStatus, 'UNKNOWN');
  assert.equal(result.bucket, 'unknown');
  assert.equal(result.rawAccountStatus, 999);
});

test('restricted and pending codes map to their own buckets', () => {
  assert.equal(classifyAdDelivery(9).deliveryStatus, 'RESTRICTED');
  assert.equal(classifyAdDelivery(7).deliveryStatus, 'PENDING');
  assert.equal(classifyAdDelivery(3).deliveryStatus, 'UNSETTLED');
  assert.equal(classifyAdDelivery(202).deliveryStatus, 'CLOSED');
});

// ===== Model ba lớp đọc từ asset đã lưu =====

test('stored deliveryStatus enum wins over numeric fields', () => {
  const resolved = resolveAdDelivery({ deliveryStatus: 'LIVE', accountStatus: 2 });
  assert.equal(resolved.deliveryStatus, 'LIVE');
  assert.equal(resolved.bucket, 'live');
});

test('stored UNKNOWN falls back to numeric account_status', () => {
  const resolved = resolveAdDelivery({ deliveryStatus: 'UNKNOWN', accountStatus: 1 });
  assert.equal(resolved.deliveryStatus, 'LIVE');
});

test('asset without any status data resolves UNKNOWN', () => {
  const resolved = resolveAdDelivery({});
  assert.equal(resolved.deliveryStatus, 'UNKNOWN');
  assert.equal(resolved.bucket, 'unknown');
  assert.equal(adBucketFromStatus({}), 'unknown');
});

test('access labels never prove LIVE delivery, including explicit UNKNOWN', () => {
  for (const status of ['Truy cập được', 'Mất quyền truy cập']) {
    assert.equal(resolveAdDelivery({ status }).deliveryStatus, 'UNKNOWN');
    assert.equal(resolveAdDelivery({ status, deliveryStatus: 'UNKNOWN' }).deliveryStatus, 'UNKNOWN');
  }
});

test('legacy discovery proves access but never overrides explicit check results', () => {
  assert.equal(resolveAdAccess({ assetSources: ['session'] }), 'ACCESSIBLE');
  assert.equal(resolveAdAccess({ assetSources: ['graph_accounts'] }), 'ACCESSIBLE');
  assert.equal(resolveAdAccess({}), 'UNKNOWN');
  for (const accessStatus of ['UNKNOWN', 'ACCESS_LOST'] as const) {
    assert.equal(resolveAdAccess({ accessStatus, assetSources: ['session'] }), accessStatus);
  }
});

test('legacy status string still buckets (demo/old rows)', () => {
  assert.equal(adBucketFromStatus({ status: 'LIVE' }), 'live');
  assert.equal(adBucketFromStatus({ status: 'DIE' }), 'die');
  assert.equal(adBucketFromStatus({ status: 'Hạn chế' }), 'restricted');
  assert.equal(adBucketFromStatus({ status: 'Chưa đọc được' }), 'unknown');
});

// ===== Thống kê dashboard =====

test('dashboard total equals the sum of all buckets including UNKNOWN', () => {
  const summary = summarizeAdAssets([
    { accountStatus: 1 },
    { accountStatus: 1 },
    { accountStatus: 2 },
    { accountStatus: 9 },
    { accountStatus: 7 },
    {},
    {},
    { metaStatus: 999 },
  ]);
  assert.equal(summary.total, 8);
  assert.equal(summary.live, 2);
  assert.equal(summary.die, 1);
  assert.equal(summary.restricted, 1);
  assert.equal(summary.pending, 1);
  assert.equal(summary.unknown, 3);
  const bucketSum = summary.live + summary.die + summary.restricted + summary.pending + summary.unsettled + summary.closed + summary.unknown;
  assert.equal(summary.total, bucketSum);
});

test('summarizeAdBuckets total equals bucket sum for raw values', () => {
  const summary = summarizeAdBuckets([1, 2, undefined, 9, '']);
  assert.equal(summary.total, 5);
  assert.equal(summary.live, 1);
  assert.equal(summary.die, 1);
  assert.equal(summary.restricted, 1);
  assert.equal(summary.unknown, 2);
  assert.equal(summary.total, summary.live + summary.die + summary.restricted + summary.pending + summary.unsettled + summary.closed + summary.unknown);
});

// ===== Nguồn đọc =====

test('read source merges graph + session into MIXED', () => {
  assert.equal(readSourceFromSources(['graph_accounts', 'session']), 'MIXED');
  assert.equal(readSourceFromSources(['graph_accounts']), 'GRAPH');
  assert.equal(readSourceFromSources(['session']), 'SESSION');
  assert.equal(readSourceFromSources(['bm_owned', 'bm_client']), 'BM_EDGE');
  assert.equal(readSourceFromSources([]), 'UNKNOWN');
  assert.equal(readSourceFromSources(undefined), 'UNKNOWN');
});
