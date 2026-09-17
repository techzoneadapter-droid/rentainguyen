import { inspectAccount } from './account-inspect';
import { aggregateCurrencies, bmClassification, mergeDiscoveredAssets, type AssetDiscoverySource } from './resource-model';
import { classifyMetaTokenError, graphListWithToken, type MetaObject } from './meta-tokens';

export type SnapshotPage = {
  id: string;
  name: string;
  tasks: string[];
  sources: AssetDiscoverySource[];
  businessIds: string[];
};

export type SnapshotAdAccount = {
  id: string;
  name: string;
  accountStatus?: number;
  disableReason?: number;
  spendCap?: string;
  currency?: string;
  sources: AssetDiscoverySource[];
  businessIds: string[];
};

export type SnapshotBusiness = {
  id: string;
  name: string;
  verificationStatus?: string;
  timezoneId?: string;
  createdTime?: string;
  primaryPage?: { id: string; name: string };
  adAccountIds: string[];
  pageIds: string[];
  pixelIds: string[];
  bmType: string;
  accountCapacity: number | null;
  adAccountCount: number;
  currencies: string[];
  currencyMode: 'SINGLE' | 'MULTI' | 'NONE';
  currency: string;
  sources: AssetDiscoverySource[];
};

export type SnapshotPixel = {
  id: string;
  name: string;
  businessIds: string[];
  sources: AssetDiscoverySource[];
};

export type AccountSnapshot = {
  actor: { id: string; name: string };
  workingCredential: { kind: 'graph' | 'session'; token: string; cookie?: string };
  confirmedPermissions: string[];
  inferredPermissions: string[];
  businesses: SnapshotBusiness[];
  adAccounts: SnapshotAdAccount[];
  pages: SnapshotPage[];
  pixels: SnapshotPixel[];
  warnings: string[];
  source: 'graph' | 'cookie' | 'mixed';
  capturedAt: string;
};

export type StoredAccountSnapshot = Omit<AccountSnapshot, 'workingCredential'> & {
  id: string;
  tokenId: string;
  workingCredential: { kind: 'graph' | 'session' };
  created: string;
};

function text(value: unknown) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function objectValue(value: unknown): MetaObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as MetaObject : {};
}

async function safeList(token: string, path: string, fields: string, warnings: string[]) {
  try {
    return await graphListWithToken(token, path, fields, 20);
  } catch (error) {
    warnings.push(`${path}: ${classifyMetaTokenError(error).reason}`);
    return [];
  }
}

function validId(value: unknown) {
  const id = text(value).replace(/^act_/, '');
  return /^\d{5,30}$/.test(id) ? id : '';
}

function capacityValue(row: MetaObject) {
  for (const key of ['account_capacity', 'ad_account_capacity', 'ad_account_limit', 'owned_ad_account_limit']) {
    const value = Number(row[key]);
    if (Number.isInteger(value) && value >= 0) return value;
  }
  return null;
}

export function storedSnapshotId(workspaceOwner: string, tokenId: string) {
  return `${workspaceOwner}:account-snapshot:${tokenId}`;
}

export function toStoredAccountSnapshot(
  workspaceOwner: string,
  tokenId: string,
  snapshot: AccountSnapshot,
): StoredAccountSnapshot {
  const { workingCredential, ...safe } = snapshot;
  return {
    ...safe,
    id: storedSnapshotId(workspaceOwner, tokenId),
    tokenId,
    workingCredential: { kind: workingCredential.kind },
    created: snapshot.capturedAt,
  };
}

export async function discoverAccountSnapshot(input: { token?: string; cookie?: string }): Promise<AccountSnapshot> {
  const inspection = await inspectAccount(input);
  const token = inspection.workingToken || String(input.token || '').trim();
  const warnings = [...inspection.warnings];
  const businessRows: Array<MetaObject & { sources: AssetDiscoverySource[] }> = inspection.businesses.map((business) => ({
    id: business.id,
    name: business.name,
    verification_status: business.verificationStatus,
    sources: ['session'],
  }));
  const adRows: SnapshotAdAccount[] = inspection.adAccounts.map((account) => ({
    id: account.id,
    name: account.name,
    accountStatus: account.accountStatus,
    sources: ['session'],
    businessIds: [],
  }));
  const pageRows: SnapshotPage[] = inspection.pages.map((page) => ({
    id: page.id,
    name: page.name,
    tasks: page.tasks || [],
    sources: page.sources || [inspection.source === 'cookie' ? 'session' : 'graph_accounts'],
    businessIds: [],
  }));
  const pixelRows: SnapshotPixel[] = [];

  if (token) {
    const [graphBusinesses, graphAccounts] = await Promise.all([
      safeList(token, `${inspection.me.id}/businesses`, 'id,name,verification_status,timezone_id,primary_page,created_time', warnings),
      safeList(token, `${inspection.me.id}/adaccounts`, 'id,name,account_status,disable_reason,spend_cap,currency', warnings),
    ]);
    businessRows.push(...graphBusinesses.map((row) => ({ ...row, sources: ['graph_accounts' as const] })));
    adRows.push(...graphAccounts.map((row) => ({
      id: validId(row.id),
      name: text(row.name) || `Ads ${validId(row.id)}`,
      accountStatus: Number(row.account_status || 0) || undefined,
      disableReason: Number(row.disable_reason || 0) || undefined,
      spendCap: text(row.spend_cap) || undefined,
      currency: text(row.currency).toUpperCase() || undefined,
      sources: ['graph_accounts' as const],
      businessIds: [],
    })));
  }

  const businessesBase = mergeDiscoveredAssets(businessRows.map((row) => ({
    ...row,
    id: validId(row.id),
    name: text(row.name) || `BM ${validId(row.id)}`,
    sources: row.sources,
  })));

  const businessDetails = new Map<string, {
    ownedAds: SnapshotAdAccount[];
    clientAds: SnapshotAdAccount[];
    ownedPages: SnapshotPage[];
    clientPages: SnapshotPage[];
    pixels: SnapshotPixel[];
  }>();

  if (token) {
    for (let offset = 0; offset < businessesBase.length; offset += 4) {
      await Promise.all(businessesBase.slice(offset, offset + 4).map(async (business) => {
        const businessId = business.id;
        const [ownedAds, clientAds, ownedPages, clientPages, pixels] = await Promise.all([
          safeList(token, `${businessId}/owned_ad_accounts`, 'id,name,account_status,disable_reason,spend_cap,currency', warnings),
          safeList(token, `${businessId}/client_ad_accounts`, 'id,name,account_status,disable_reason,spend_cap,currency', warnings),
          safeList(token, `${businessId}/owned_pages`, 'id,name,tasks', warnings),
          safeList(token, `${businessId}/client_pages`, 'id,name,tasks', warnings),
          safeList(token, `${businessId}/adspixels`, 'id,name', warnings),
        ]);
        const mapAd = (row: MetaObject, source: AssetDiscoverySource): SnapshotAdAccount => ({
          id: validId(row.id),
          name: text(row.name) || `Ads ${validId(row.id)}`,
          accountStatus: Number(row.account_status || 0) || undefined,
          disableReason: Number(row.disable_reason || 0) || undefined,
          spendCap: text(row.spend_cap) || undefined,
          currency: text(row.currency).toUpperCase() || undefined,
          sources: [source],
          businessIds: [businessId],
        });
        const mapPage = (row: MetaObject, source: AssetDiscoverySource): SnapshotPage => ({
          id: validId(row.id),
          name: text(row.name) || `Page ${validId(row.id)}`,
          tasks: Array.isArray(row.tasks) ? row.tasks.map(String) : [],
          sources: [source],
          businessIds: [businessId],
        });
        businessDetails.set(businessId, {
          ownedAds: ownedAds.map((row) => mapAd(row, 'bm_owned')),
          clientAds: clientAds.map((row) => mapAd(row, 'bm_client')),
          ownedPages: ownedPages.map((row) => mapPage(row, 'bm_owned')),
          clientPages: clientPages.map((row) => mapPage(row, 'bm_client')),
          pixels: pixels.map((row) => ({
            id: validId(row.id),
            name: text(row.name) || `Pixel ${validId(row.id)}`,
            sources: ['bm_owned'],
            businessIds: [businessId],
          })),
        });
      }));
    }
  }

  for (const detail of businessDetails.values()) {
    adRows.push(...detail.ownedAds, ...detail.clientAds);
    pageRows.push(...detail.ownedPages, ...detail.clientPages);
    pixelRows.push(...detail.pixels);
  }

  const adAccounts = mergeDiscoveredAssets(adRows.map((row) => ({ ...row, id: validId(row.id) }))).map((row) => ({
    ...row,
    businessIds: [...new Set(row.businessIds || [])],
  }));
  const pages = mergeDiscoveredAssets(pageRows.map((row) => ({ ...row, id: validId(row.id) }))).map((row) => ({
    ...row,
    businessIds: [...new Set(row.businessIds || [])],
  }));
  const pixels = mergeDiscoveredAssets(pixelRows.map((row) => ({ ...row, id: validId(row.id) }))).map((row) => ({
    ...row,
    businessIds: [...new Set(row.businessIds || [])],
  }));

  const businesses: SnapshotBusiness[] = businessesBase.map((business) => {
    const businessRecord = business as typeof business & MetaObject;
    const detail = businessDetails.get(business.id);
    const businessAds = mergeDiscoveredAssets([...(detail?.ownedAds || []), ...(detail?.clientAds || [])]);
    const businessPages = mergeDiscoveredAssets([...(detail?.ownedPages || []), ...(detail?.clientPages || [])]);
    const currencies = aggregateCurrencies(businessAds.map((account) => account.currency));
    const classification = bmClassification(capacityValue(business), businessAds.length);
    const primaryPage = objectValue(businessRecord.primary_page);
    return {
      id: business.id,
      name: business.name,
      verificationStatus: text(businessRecord.verification_status) || undefined,
      timezoneId: text(businessRecord.timezone_id) || undefined,
      createdTime: text(businessRecord.created_time) || undefined,
      primaryPage: validId(primaryPage.id) ? { id: validId(primaryPage.id), name: text(primaryPage.name) } : undefined,
      adAccountIds: businessAds.map((account) => account.id),
      pageIds: businessPages.map((page) => page.id),
      pixelIds: detail?.pixels.map((pixel) => pixel.id) || [],
      ...classification,
      ...currencies,
      sources: business.sources,
    };
  });

  return {
    actor: inspection.me,
    workingCredential: {
      kind: inspection.source === 'cookie' ? 'session' : 'graph',
      token,
      ...(input.cookie ? { cookie: input.cookie } : {}),
    },
    confirmedPermissions: inspection.confirmedPermissions,
    inferredPermissions: inspection.inferredPermissions,
    businesses,
    adAccounts,
    pages,
    pixels,
    warnings: [...new Set(warnings)].slice(0, 40),
    source: inspection.source,
    capturedAt: new Date().toISOString(),
  };
}
