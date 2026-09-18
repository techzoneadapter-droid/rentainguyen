/**
 * Model trạng thái TKQC (Ad Account) dùng chung cho snapshot, health check và UI.
 *
 * Tách ba khái niệm không được gom làm một:
 * - accessStatus: credential đang xét còn truy cập được TKQC hay không.
 * - deliveryStatus: trạng thái quảng cáo theo account_status của Meta.
 * - readSource: tầng dữ liệu đã đọc được (Graph / Session / BM edge /Mixed).
 *
 * Nguyên tắc: undefined/null/'' là CHƯA BIẾT, không phải 0 và không phải restricted.
 */

export type AdAccessStatus = 'ACCESSIBLE' | 'ACCESS_LOST' | 'UNKNOWN';
export type AdDeliveryStatus =
  | 'LIVE'
  | 'DISABLED'
  | 'RESTRICTED'
  | 'PENDING'
  | 'UNSETTLED'
  | 'CLOSED'
  | 'UNKNOWN';
export type AdReadSource = 'GRAPH' | 'SESSION' | 'BM_EDGE' | 'MIXED' | 'UNKNOWN';

export type AdBucket = 'live' | 'die' | 'restricted' | 'pending' | 'unsettled' | 'closed' | 'unknown';

export type AdDeliveryClassification = {
  deliveryStatus: AdDeliveryStatus;
  bucket: AdBucket;
  /** Raw account_status của Meta, giữ nguyên để không mất thông tin khi code chưa map. */
  rawAccountStatus?: number;
};

/** Các account_status Meta đã biết và ý nghĩa tương ứng. */
const KNOWN_STATUS: Record<number, { delivery: AdDeliveryStatus; bucket: AdBucket }> = {
  1: { delivery: 'LIVE', bucket: 'live' },
  2: { delivery: 'DISABLED', bucket: 'die' },
  101: { delivery: 'DISABLED', bucket: 'die' },
  3: { delivery: 'UNSETTLED', bucket: 'unsettled' },
  7: { delivery: 'PENDING', bucket: 'pending' },
  8: { delivery: 'PENDING', bucket: 'pending' },
  9: { delivery: 'RESTRICTED', bucket: 'restricted' },
  100: { delivery: 'RESTRICTED', bucket: 'restricted' },
  202: { delivery: 'CLOSED', bucket: 'closed' },
};

/**
 * Phân loại account_status. missing (undefined/null/'') và code chưa map
 * đều trả UNKNOWN kèm rawAccountStatus gốc, không suy đoán thành restricted.
 */
export function classifyAdDelivery(statusValue: unknown): AdDeliveryClassification {
  if (statusValue === undefined || statusValue === null || statusValue === '') {
    return { deliveryStatus: 'UNKNOWN', bucket: 'unknown' };
  }
  const status = Number(statusValue);
  if (!Number.isFinite(status)) {
    return { deliveryStatus: 'UNKNOWN', bucket: 'unknown' };
  }
  const known = KNOWN_STATUS[status];
  if (known) return { deliveryStatus: known.delivery, bucket: known.bucket, rawAccountStatus: status };
  return { deliveryStatus: 'UNKNOWN', bucket: 'unknown', rawAccountStatus: status };
}

/** adBucket cho thống kê kho token; undefined là 'unknown', không bao giờ 'restricted'. */
export function adBucket(statusValue: unknown): AdBucket {
  return classifyAdDelivery(statusValue).bucket;
}

const DELIVERY_TO_BUCKET: Record<AdDeliveryStatus, AdBucket> = {
  LIVE: 'live',
  DISABLED: 'die',
  RESTRICTED: 'restricted',
  PENDING: 'pending',
  UNSETTLED: 'unsettled',
  CLOSED: 'closed',
  UNKNOWN: 'unknown',
};

const DELIVERY_VALUES = new Set<string>(Object.keys(DELIVERY_TO_BUCKET));

export type AdStatusInput = {
  deliveryStatus?: string;
  accountStatus?: unknown;
  metaStatus?: unknown;
  /** Chuỗi status legacy của asset cũ ('LIVE'/'DIE'/'Hạn chế'...). */
  status?: string;
};

function legacyStatusToDelivery(value: string | undefined): AdDeliveryStatus | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'live') return 'LIVE';
  if (normalized === 'die' || normalized.includes('disabled') || normalized.includes('vô hiệu') || normalized.includes('đã đóng')) return 'DISABLED';
  if (normalized.includes('hạn chế') || normalized.includes('restricted')) return 'RESTRICTED';
  if (normalized.includes('pending')) return 'PENDING';
  return undefined;
}

/**
 * Phân loại bucket cho một asset đã lưu: ưu tiên deliveryStatus enum mới,
 * fallback account_status/meta_status số, cuối cùng là chuỗi status legacy.
 * Không có dữ liệu nào => 'unknown' (không suy đoán).
 */
export function resolveAdDelivery(input: AdStatusInput): AdDeliveryClassification {
  const stored = String(input.deliveryStatus || '');
  if (DELIVERY_VALUES.has(stored) && stored !== 'UNKNOWN') {
    const delivery = stored as AdDeliveryStatus;
    return { deliveryStatus: delivery, bucket: DELIVERY_TO_BUCKET[delivery] };
  }
  if (input.accountStatus !== undefined && input.accountStatus !== null && input.accountStatus !== '') {
    return classifyAdDelivery(input.accountStatus);
  }
  if (input.metaStatus !== undefined && input.metaStatus !== null && input.metaStatus !== '') {
    return classifyAdDelivery(input.metaStatus);
  }
  const legacy = legacyStatusToDelivery(input.status);
  if (legacy) return { deliveryStatus: legacy, bucket: DELIVERY_TO_BUCKET[legacy] };
  return { deliveryStatus: 'UNKNOWN', bucket: 'unknown' };
}

export function adBucketFromStatus(input: AdStatusInput): AdBucket {
  return resolveAdDelivery(input).bucket;
}

/** Thống kê danh sách asset (mỗi asset một bucket, total luôn bằng tổng bucket). */
export function summarizeAdAssets(assets: AdStatusInput[]) {
  const summary = {
    total: assets.length,
    live: 0,
    die: 0,
    restricted: 0,
    pending: 0,
    unsettled: 0,
    closed: 0,
    unknown: 0,
  };
  for (const asset of assets) summary[resolveAdDelivery(asset).bucket] += 1;
  return summary;
}

/** Gộp danh sách nguồn đọc (assetSources của snapshot) thành một AdReadSource. */
export function readSourceFromSources(sources: Array<string | undefined | null> | undefined): AdReadSource {
  const present = new Set((sources || []).filter((value): value is string => Boolean(value)));
  const hasGraph = present.has('graph_accounts');
  const hasSession = present.has('session');
  const hasEdge = present.has('bm_owned') || present.has('bm_client');
  if (hasGraph && hasSession) return 'MIXED';
  if (hasGraph) return 'GRAPH';
  if (hasSession) return 'SESSION';
  if (hasEdge) return 'BM_EDGE';
  return 'UNKNOWN';
}

/** Older discovered rows have provenance but no explicit access field. Never
 * override a later check's UNKNOWN or ACCESS_LOST with discovery history. */
export function resolveAdAccess(input: {
  accessStatus?: AdAccessStatus;
  assetSources?: string[];
}): AdAccessStatus {
  if (input.accessStatus) return input.accessStatus;
  return readSourceFromSources(input.assetSources) !== 'UNKNOWN' ? 'ACCESSIBLE' : 'UNKNOWN';
}

const DELIVERY_LABEL: Record<AdDeliveryStatus, string> = {
  LIVE: 'LIVE',
  DISABLED: 'DIE / DISABLED',
  RESTRICTED: 'HẠN CHẾ',
  PENDING: 'PENDING',
  UNSETTLED: 'CHƯA THANH TOÁN',
  CLOSED: 'ĐÃ ĐÓNG',
  UNKNOWN: 'CHƯA XÁC ĐỊNH',
};

const ACCESS_LABEL: Record<AdAccessStatus, string> = {
  ACCESSIBLE: 'TRUY CẬP ĐƯỢC',
  ACCESS_LOST: 'MẤT QUYỀN TRUY CẬP',
  UNKNOWN: 'CHƯA XÁC ĐỊNH',
};

const SOURCE_LABEL: Record<AdReadSource, string> = {
  GRAPH: 'Graph',
  SESSION: 'Session',
  BM_EDGE: 'BM edge',
  MIXED: 'Graph + Session',
  UNKNOWN: 'Chưa rõ',
};

export function adDeliveryLabel(delivery: AdDeliveryStatus | undefined) {
  return DELIVERY_LABEL[delivery || 'UNKNOWN'];
}

export function adAccessLabel(access: AdAccessStatus | undefined) {
  return ACCESS_LABEL[access || 'UNKNOWN'];
}

export function adReadSourceLabel(source: AdReadSource | undefined) {
  return SOURCE_LABEL[source || 'UNKNOWN'];
}

/** Thống kê kho TKQC; total luôn bằng tổng các bucket (không bỏ sót bucket lạ). */
export function summarizeAdBuckets(statusValues: Array<unknown>) {
  const summary = {
    total: statusValues.length,
    live: 0,
    die: 0,
    restricted: 0,
    pending: 0,
    unsettled: 0,
    closed: 0,
    unknown: 0,
  };
  for (const value of statusValues) summary[adBucket(value)] += 1;
  return summary;
}
