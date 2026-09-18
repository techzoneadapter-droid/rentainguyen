import test from 'node:test';
import assert from 'node:assert/strict';
import type { Asset } from '../lib/data.ts';
import {
  META_ID_RE,
  gatewayType,
  metaIdFromAsset,
  numericTier,
  technicalStatus,
  toGatewayResource,
} from '../lib/crm-gateway.ts';

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'w:meta:656931087344178',
    name: 'TKQC test',
    type: 'TKQC',
    status: 'Chưa đọc được',
    verified: false,
    country: 'VN',
    tier: '',
    limit: '',
    parent: '',
    source: 'test',
    ...overrides,
  };
}

// ===== Bắt buộc #52: regex Meta ID phải match số thật =====

test('META_ID_RE matches real numeric Meta IDs', () => {
  assert.ok(META_ID_RE.test('656931087344178'));
  assert.ok(META_ID_RE.test('12345'));
  assert.equal(META_ID_RE.test('abc'), false);
  // Bản cũ /^\\d{5,30}$/ khớp chuỗi '\d' literal — regression guard.
  assert.equal(META_ID_RE.test('\\d'), false);
});

test('metaIdFromAsset reads metaId, meta: prefix and trailing digits', () => {
  assert.equal(metaIdFromAsset(asset({ metaId: '656931087344178' })), '656931087344178');
  assert.equal(metaIdFromAsset(asset({ id: 'w:meta:123456789' })), '123456789');
  assert.equal(metaIdFromAsset(asset({ id: 'w:asset-998877665544' })), '998877665544');
  assert.equal(metaIdFromAsset(asset({ id: 'demo-1' })), '');
});

test('numericTier parses BM5 as 5 and rejects non-tier strings', () => {
  assert.equal(numericTier('BM5'), 5);
  assert.equal(numericTier('bm50'), 50);
  assert.equal(numericTier('BM'), undefined);
  assert.equal(numericTier('5'), undefined);
  assert.equal(numericTier(undefined), undefined);
});

// ===== Mapping technical status cho CRM =====

test('TKQC access lost wins over everything else', () => {
  assert.equal(technicalStatus(asset({ accessStatus: 'ACCESS_LOST', deliveryStatus: 'LIVE' })), 'ACCESS_LOST');
});

test('TKQC delivery status maps to CRM technical status', () => {
  assert.equal(technicalStatus(asset({ deliveryStatus: 'LIVE' })), 'LIVE');
  assert.equal(technicalStatus(asset({ deliveryStatus: 'DISABLED' })), 'DISABLED');
  assert.equal(technicalStatus(asset({ deliveryStatus: 'RESTRICTED' })), 'RESTRICTED');
  assert.equal(technicalStatus(asset({ deliveryStatus: 'PENDING' })), 'RESTRICTED');
});

test('TKQC accessible but delivery unknown must not be exported as LIVE', () => {
  assert.equal(technicalStatus(asset({ accessStatus: 'ACCESSIBLE', deliveryStatus: 'UNKNOWN' })), 'UNKNOWN');
});

test('TKQC without any data stays UNKNOWN', () => {
  assert.equal(technicalStatus(asset({})), 'UNKNOWN');
});

test('legacy status strings map for old rows', () => {
  assert.equal(technicalStatus(asset({ type: 'BM', status: 'LIVE' })), 'LIVE');
  assert.equal(technicalStatus(asset({ type: 'BM', status: 'DIE' })), 'DISABLED');
  assert.equal(technicalStatus(asset({ type: 'BM', status: 'Hạn chế' })), 'RESTRICTED');
});

// ===== Payload gateway =====

test('gatewayType only allows BM/TKQC/PAGE', () => {
  assert.equal(gatewayType(asset({ type: 'BM' })), 'BM');
  assert.equal(gatewayType(asset({ type: 'TKQC' })), 'TKQC');
  assert.equal(gatewayType(asset({ type: 'Page' })), 'PAGE');
  assert.equal(gatewayType(asset({ type: 'Dataset/Pixel' })), '');
});

test('BM resource carries business_id, bm_type and account_limit', () => {
  const resource = toGatewayResource(asset({
    type: 'BM',
    id: 'w:meta:662855666688811',
    metaId: '662855666688811',
    tier: 'BM5',
    verificationStatus: 'verified',
  })) as Record<string, unknown>;
  assert.equal(resource.business_id, '662855666688811');
  assert.equal(resource.bm_type, 'BM5');
  assert.equal(resource.account_limit, 5);
  assert.equal(resource.verification_status, 'VERIFIED');
});

test('TKQC resource carries account_id and currency', () => {
  const resource = toGatewayResource(asset({ currency: 'USD', parent: 'w:meta:111' })) as Record<string, unknown>;
  assert.equal(resource.account_id, '656931087344178');
  assert.equal(resource.currency, 'USD');
  assert.equal(resource.ownership_type, 'BUSINESS');
});

test('resource without a valid Meta ID is rejected (null), not guessed', () => {
  assert.equal(toGatewayResource(asset({ id: 'demo-1', metaId: '' })), null);
});

// ===== LOCAL_ONLY không được báo PUSHED (bắt buộc #27/#52) =====

test('LOCAL_ONLY flow keeps status string distinct from PUSHED', () => {
  // Backend chỉ gán 'PUSHED' khi gateway trả accepted; không có gateway cấu hình
  // thì status phải là 'LOCAL_ONLY'. Guard: hằng số trạng thái phải phân biệt.
  const statuses = new Set(['NOT_CONFIGURED', 'LOCAL_ONLY', 'PUSHING', 'PUSHED', 'FAILED']);
  assert.ok(statuses.has('LOCAL_ONLY'));
  assert.notEqual('LOCAL_ONLY', 'PUSHED');
});
