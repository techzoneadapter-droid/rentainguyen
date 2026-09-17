import type { Asset } from './data';

export type AssetDiscoverySource = 'graph_accounts' | 'session' | 'bm_owned' | 'bm_client';
export type CurrencyMode = 'SINGLE' | 'MULTI' | 'NONE';
export type AccessLinkStatus = 'none' | 'generating' | 'ready' | 'failed';
export type ShopStatus = 'not_ready' | 'ready' | 'pushing' | 'pushed' | 'failed';

export type DiscoveredAsset = {
  id: string;
  name: string;
  sources: AssetDiscoverySource[];
  [key: string]: unknown;
};

export function resolveAccountAvailability(graphSucceeded: boolean, sessionAlive: boolean) {
  return {
    live: graphSucceeded || sessionAlive,
    source: graphSucceeded ? (sessionAlive ? 'mixed' : 'graph') : sessionAlive ? 'cookie' : 'none',
  } as const;
}

function text(value: unknown) {
  return value === undefined || value === null ? '' : String(value).trim();
}

export function metaAssetId(asset: Pick<Asset, 'id' | 'metaId'>) {
  if (asset.metaId && /^\d{5,30}$/.test(asset.metaId)) return asset.metaId;
  return asset.id.match(/(?:^|:)meta:(\d{5,30})(?:$|:)/)?.[1]
    || asset.id.match(/(\d{5,30})$/)?.[1]
    || '';
}

export function canonicalOpenUrl(asset: Pick<Asset, 'id' | 'metaId' | 'type'>) {
  const id = metaAssetId(asset);
  if (asset.type === 'BM') return `https://business.facebook.com/settings/?business_id=${id}`;
  if (asset.type === 'TKQC') return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${id}`;
  if (asset.type === 'Page') return `https://www.facebook.com/${id}`;
  return 'https://business.facebook.com/';
}

export function mergeDiscoveredAssets<T extends DiscoveredAsset>(rows: T[]) {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (!/^\d{5,30}$/.test(row.id)) continue;
    const current = map.get(row.id);
    if (!current) {
      map.set(row.id, { ...row, sources: [...new Set(row.sources)] });
      continue;
    }
    const currentName = text(current.name);
    const nextName = text(row.name);
    const genericName = (value: string) => (
      !value
      || value === row.id
      || new RegExp(`^(?:BM|Business|Ads|Ad account|Page|Pixel|Dataset)\\s+${row.id}$`, 'i').test(value)
    );
    const defined = Object.fromEntries(Object.entries(row).filter(([, value]) => {
      if (value === undefined || value === null || value === '') return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    })) as Partial<T>;
    const mergedArrays: Record<string, unknown[]> = {};
    for (const key of ['businessIds', 'tasks']) {
      const before = Array.isArray(current[key]) ? current[key] as unknown[] : [];
      const after = Array.isArray(row[key]) ? row[key] as unknown[] : [];
      if (before.length || after.length) mergedArrays[key] = [...new Set([...before, ...after])];
    }
    map.set(row.id, {
      ...current,
      ...defined,
      ...mergedArrays,
      name: !genericName(nextName) || genericName(currentName) ? nextName || currentName || row.id : currentName,
      sources: [...new Set([...current.sources, ...row.sources])],
    } as T);
  }
  return [...map.values()];
}

export function aggregateCurrencies(values: Array<string | null | undefined>) {
  const currencies = [...new Set(values.map((value) => text(value).toUpperCase()).filter(Boolean))].sort();
  const currencyMode: CurrencyMode = currencies.length === 0 ? 'NONE' : currencies.length === 1 ? 'SINGLE' : 'MULTI';
  return {
    currencies,
    currencyMode,
    currency: currencyMode === 'NONE' ? 'NONE' : currencyMode === 'MULTI' ? 'MULTI' : currencies[0],
  };
}

export function bmClassification(
  accountCapacity: number | null | undefined,
  adAccountCount: number,
  ownedAdAccountCount: number | null | undefined,
  observedOwnedAdAccountCount = 0,
) {
  const capacity = Number.isInteger(accountCapacity) && Number(accountCapacity) >= 0
    ? Number(accountCapacity)
    : null;
  const ownedCount = Number.isInteger(ownedAdAccountCount) && Number(ownedAdAccountCount) >= 0
    ? Number(ownedAdAccountCount)
    : null;
  const observedOwned = Math.max(0, Number(observedOwnedAdAccountCount) || 0);
  return {
    bmType: ownedCount === null ? (observedOwned ? `BM${observedOwned}+` : 'UNKNOWN') : `BM${ownedCount}`,
    accountCapacity: capacity,
    adAccountCount: Math.max(0, Number(adAccountCount) || 0),
    ownedAdAccountCount: ownedCount,
  };
}

export function shopValidationErrors(asset: Asset) {
  const missing: string[] = [];
  if (asset.type !== 'BM') return ['type: chỉ BM được phép đẩy Shop'];
  if (asset.accessLinkStatus !== 'ready') missing.push('accessLinkStatus: phải là ready');
  if (!asset.accessLink) missing.push('accessLink');
  if (!asset.bmType || asset.bmType === 'UNKNOWN') missing.push('bmType');
  if (asset.accountCapacity === undefined || asset.accountCapacity === null) missing.push('accountCapacity');
  if (asset.adAccountCount === undefined || asset.adAccountCount === null) missing.push('adAccountCount');
  if (!asset.currency || asset.currency === 'NONE') missing.push('currency');
  return missing;
}

export function shopIdempotencyKey(asset: Asset) {
  return asset.id || metaAssetId(asset);
}

export function shopPushDisposition(asset: Asset) {
  return asset.shopStatus === 'pushed' && Boolean(asset.shopProductId) ? 'idempotent' : 'push';
}

export function buildShopPayload(asset: Asset) {
  const businessId = metaAssetId(asset);
  return {
    resource_id: asset.id,
    business_id: businessId,
    bm_type: asset.bmType,
    account_capacity: asset.accountCapacity,
    ad_account_count: asset.adAccountCount,
    currency: asset.currencyMode === 'MULTI' ? 'MULTI' : asset.currency,
    ...(asset.currencies?.length ? { currencies: asset.currencies } : {}),
    access_link: asset.accessLink,
  };
}

export async function runIndependentBatch<T, R>(
  items: T[],
  task: (item: T, index: number) => Promise<R>,
  options: { continueOnError?: boolean; maxConsecutiveErrors?: number; stopOnError?: (error: unknown) => boolean } = {},
) {
  const results: Array<{ index: number; item: T; ok: true; value: R } | { index: number; item: T; ok: false; error: unknown }> = [];
  const continueOnError = options.continueOnError !== false;
  const maxConsecutiveErrors = Math.max(1, options.maxConsecutiveErrors || 3);
  let consecutiveErrors = 0;
  for (let index = 0; index < items.length; index += 1) {
    try {
      const value = await task(items[index], index);
      results.push({ index, item: items[index], ok: true, value });
      consecutiveErrors = 0;
    } catch (error) {
      results.push({ index, item: items[index], ok: false, error });
      consecutiveErrors += 1;
      if (options.stopOnError?.(error)) break;
      if (!continueOnError || consecutiveErrors >= maxConsecutiveErrors) break;
    }
  }
  return results;
}

/** Run async workers over items with bounded concurrency, preserving input order. */
export async function mapPool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  if (!items.length) return results;
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}
