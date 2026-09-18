/**
 * Mapping asset -> resource cho CRM/gateway. Tách ra lib để test được regex và
 * technical status mà không phải import route (route phụ thuộc D1/cloudflare).
 *
 * Lưu ý regex: trong RegExp literal JS phải viết /^\d{5,30}$/ (một backslash).
 * Bản cũ /^\\d{5,30}$/ khớp ký tự '\d'literal nên không bao giờ match số.
 */
import type { Asset } from './data';
// Value import cần đuôi .ts để node --test (strip-types) resolve được khi chạy test.
import { classifyAdDelivery } from './ad-status.ts';
import { canonicalOpenUrl } from './resource-model.ts';

export const META_ID_RE = /^\d{5,30}$/;

export function metaIdFromAsset(asset: Asset): string {
  if (asset.metaId && META_ID_RE.test(asset.metaId)) return asset.metaId;
  const match = asset.id.match(/(?:^|:)meta:(\d{5,30})(?:$|:)/) || asset.id.match(/(\d{5,30})$/);
  return match?.[1] || '';
}

export function gatewayType(asset: Asset) {
  if (asset.type === 'BM' || asset.type === 'TKQC') return asset.type;
  if (asset.type === 'Page') return 'PAGE';
  return '';
}

export type CrmTechnicalStatus = 'LIVE' | 'DISABLED' | 'RESTRICTED' | 'ACCESS_LOST' | 'UNKNOWN';

/**
 * Ưu tiên model ba lớp (deliveryStatus/accessStatus) đã lưu trên asset; chỉ parse
 * chuỗi hiển thị khi asset cũ chưa có field mới.
 */
export function technicalStatus(asset: Asset): CrmTechnicalStatus {
  if (asset.type === 'TKQC') {
    if (asset.accessStatus === 'ACCESS_LOST') return 'ACCESS_LOST';
    const delivery = asset.deliveryStatus || classifyAdDelivery(asset.accountStatus ?? asset.metaStatus).deliveryStatus;
    if (delivery === 'LIVE') return 'LIVE';
    if (delivery === 'DISABLED' || delivery === 'CLOSED' || delivery === 'UNSETTLED') return 'DISABLED';
    if (delivery === 'RESTRICTED' || delivery === 'PENDING') return 'RESTRICTED';
    return 'UNKNOWN';
  }
  const value = String(asset.status || '').toLowerCase();
  if (asset.status === 'LIVE' || value.includes('truy cập') || value.includes('live')) return 'LIVE';
  if (asset.status === 'DIE' || value.includes('disabled') || value.includes('vô hiệu') || value.includes('đã đóng')) return 'DISABLED';
  if (value.includes('hạn chế') || value.includes('restricted') || value.includes('cần kiểm tra quyền')) return 'RESTRICTED';
  if (value.includes('access lost') || value.includes('mất quyền')) return 'ACCESS_LOST';
  return 'UNKNOWN';
}

export function numericTier(tier: string | undefined) {
  const match = String(tier || '').match(/^BM(\d+)$/i);
  return match ? Number(match[1]) : undefined;
}

function cleanCountry(country: string | undefined) {
  const value = String(country || '').trim();
  if (!value || value.toLowerCase().includes('chưa')) return undefined;
  return value;
}

export function toGatewayResource(asset: Asset) {
  const id = metaIdFromAsset(asset);
  const type = gatewayType(asset);
  if (!id || !type) return null;

  const technical = technicalStatus(asset);
  const base: Record<string, unknown> = {
    type,
    code: `AW-${type}-${id.slice(-14)}`,
    name: asset.name,
    technical_status: technical,
    country: cleanCountry(asset.country),
    health_score: technical === 'LIVE' ? 90 : 60,
    external_profile_id: canonicalOpenUrl(asset),
  };

  if (type === 'BM') {
    base.business_id = id;
    base.verification_status = asset.verificationStatus
      ? String(asset.verificationStatus).toUpperCase()
      : asset.verified
        ? 'VERIFIED'
        : 'UNVERIFIED';
    if (/^BM\d+$/i.test(String(asset.tier || ''))) base.bm_type = asset.tier;
    const limit = numericTier(asset.tier);
    if (limit !== undefined) base.account_limit = limit;
    base.operation_region = cleanCountry(asset.country);
  } else if (type === 'TKQC') {
    base.account_id = id;
    base.ownership_type = asset.parent ? 'BUSINESS' : 'PERSONAL';
    if (asset.currency) base.currency = asset.currency;
  } else {
    base.page_id = id;
  }

  return base;
}
