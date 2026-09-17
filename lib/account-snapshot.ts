import { inspectAccount } from './account-inspect';
import { aggregateCurrencies, bmClassification, mergeDiscoveredAssets, type AssetDiscoverySource } from './resource-model';
import { classifyMetaTokenError, graphListWithToken, type MetaObject } from './meta-tokens';

export type SnapshotPage = {
  id: string;
  name: string;
  tasks: string[];
  category?: string;
  verificationStatus?: string;
  followersCount?: number;
  fanCount?: number;
  link?: string;
  sources: AssetDiscoverySource[];
  businessIds: string[];
};

export type SnapshotAdAccount = {
  id: string;
  name: string;
  accountStatus?: number;
  disableReason?: number;
  spendCap?: string;
  amountSpent?: string;
  balance?: string;
  minDailyBudget?: string;
  currency?: string;
  timezoneId?: string;
  timezoneName?: string;
  timezoneOffsetHoursUtc?: number;
  isPrepayAccount?: boolean;
  fundingSource?: string;
  fundingType?: string;
  fundingDisplay?: string;
  ownerId?: string;
  businessName?: string;
  country?: string;
  ownership?: 'owned' | 'client' | 'unknown';
  createdTime?: string;
  sources: AssetDiscoverySource[];
  businessIds: string[];
};

export type SnapshotBusiness = {
  id: string;
  name: string;
  verificationStatus?: string;
  timezoneId?: string;
  createdTime?: string;
  updatedTime?: string;
  vertical?: string;
  twoFactorType?: string;
  primaryPage?: { id: string; name: string };
  adAccountIds: string[];
  pageIds: string[];
  pixelIds: string[];
  bmType: string;
  accountCapacity: number | null;
  adAccountCount: number | null;
  ownedAdAccountCount: number | null;
  pageCount: number | null;
  observedAdAccountCount: number;
  observedOwnedAdAccountCount: number;
  observedPageCount: number;
  country?: string;
  detailsStatus: 'complete' | 'partial' | 'unavailable';
  currencies: string[];
  currencyMode: 'SINGLE' | 'MULTI' | 'NONE';
  currency: string;
  sources: AssetDiscoverySource[];
};

export type SnapshotPixel = {
  id: string;
  name: string;
  creationTime?: string;
  lastFiredTime?: string;
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

const AD_ACCOUNT_FIELDS = [
  'id,account_id,name,account_status,disable_reason,currency,amount_spent,balance,spend_cap,min_daily_budget,timezone_id,timezone_name,timezone_offset_hours_utc,is_prepay_account,funding_source,funding_source_details,business,owner,created_time,business_country_code',
  'id,account_id,name,account_status,disable_reason,currency,amount_spent,balance,spend_cap,timezone_id,timezone_name,is_prepay_account,business',
  'id,account_id,name,account_status,disable_reason,currency,spend_cap',
];
const PAGE_FIELDS = [
  'id,name,category,verification_status,followers_count,fan_count,link,tasks',
  'id,name,category,verification_status,link,tasks',
  'id,name,tasks',
];
const BUSINESS_FIELDS = [
  'id,name,verification_status,timezone_id,primary_page,created_time,updated_time,vertical,two_factor_type,business_country_code,owned_ad_account_count',
  'id,name,verification_status,timezone_id,primary_page,created_time,updated_time,vertical,two_factor_type,business_country_code',
  'id,name,verification_status,timezone_id,primary_page,created_time,updated_time,vertical,two_factor_type',
  'id,name,verification_status,timezone_id,primary_page,created_time,vertical',
  'id,name,verification_status,primary_page',
];
const PIXEL_FIELDS = [
  'id,name,creation_time,last_fired_time',
  'id,name',
];

async function tryList(token: string, path: string, fields: string | string[], warnings: string[]) {
  const variants = Array.isArray(fields) ? fields : [fields];
  let lastError: unknown;
  for (let index = 0; index < variants.length; index += 1) {
    try {
      const rows = await graphListWithToken(token, path, variants[index], 20);
      if (index > 0) warnings.push(`${path}: Meta không cho đọc một số field mở rộng; đã dùng bộ field tương thích.`);
      return { ok: true as const, rows };
    } catch (error) {
      lastError = error;
      const classified = classifyMetaTokenError(error);
      if (index === variants.length - 1 || ![100, 200].includes(classified.code || -1)) break;
    }
  }
  warnings.push(`${path}: ${classifyMetaTokenError(lastError).reason}`);
  return { ok: false as const, rows: [] as MetaObject[] };
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

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function optionalBoolean(value: unknown) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return undefined;
}

function mapAdAccount(row: MetaObject, source: AssetDiscoverySource, businessId = ''): SnapshotAdAccount {
  const id = validId(row.id) || validId(row.account_id);
  const business = objectValue(row.business);
  const funding = objectValue(row.funding_source_details);
  const owner = objectValue(row.owner);
  const linkedBusinessId = validId(business.id);
  return {
    id,
    name: text(row.name) || `Ads ${id}`,
    accountStatus: optionalNumber(row.account_status),
    disableReason: optionalNumber(row.disable_reason),
    spendCap: text(row.spend_cap) || undefined,
    amountSpent: text(row.amount_spent) || undefined,
    balance: text(row.balance) || undefined,
    minDailyBudget: text(row.min_daily_budget) || undefined,
    currency: text(row.currency).toUpperCase() || undefined,
    timezoneId: text(row.timezone_id) || undefined,
    timezoneName: text(row.timezone_name) || undefined,
    timezoneOffsetHoursUtc: optionalNumber(row.timezone_offset_hours_utc),
    isPrepayAccount: optionalBoolean(row.is_prepay_account),
    fundingSource: text(row.funding_source) || undefined,
    fundingType: text(funding.type) || undefined,
    fundingDisplay: text(funding.display_string) || undefined,
    ownerId: validId(row.owner) || validId(owner.id) || undefined,
    businessName: text(business.name) || undefined,
    country: text(row.business_country_code).toUpperCase() || undefined,
    ownership: source === 'bm_owned'
      ? 'owned'
      : source === 'bm_client'
        ? 'client'
        : linkedBusinessId && (validId(row.owner) || validId(owner.id)) === linkedBusinessId
          ? 'owned'
          : 'unknown',
    createdTime: text(row.created_time) || undefined,
    sources: [source],
    businessIds: [...new Set([businessId, linkedBusinessId].filter(Boolean))],
  };
}

function mapPage(row: MetaObject, source: AssetDiscoverySource, businessId = ''): SnapshotPage {
  const id = validId(row.id);
  return {
    id,
    name: text(row.name) || `Page ${id}`,
    tasks: Array.isArray(row.tasks) ? row.tasks.map(String) : [],
    category: text(row.category) || undefined,
    verificationStatus: text(row.verification_status) || undefined,
    followersCount: optionalNumber(row.followers_count),
    fanCount: optionalNumber(row.fan_count),
    link: text(row.link) || undefined,
    sources: [source],
    businessIds: businessId ? [businessId] : [],
  };
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
  const businessRows: Array<MetaObject & { sources: AssetDiscoverySource[] }> = [];
  const adRows: SnapshotAdAccount[] = [];
  const pageRows: SnapshotPage[] = inspection.pages.map((page) => ({
    id: page.id,
    name: page.name,
    tasks: page.tasks || [],
    category: page.category,
    verificationStatus: page.verificationStatus,
    followersCount: page.followersCount,
    fanCount: page.fanCount,
    link: page.link,
    sources: page.sources || [inspection.source === 'cookie' ? 'session' : 'graph_accounts'],
    businessIds: page.businessIds || [],
  }));
  const pixelRows: SnapshotPixel[] = [];

  let actorGraphUsable = false;
  if (token) {
    const [graphBusinesses, graphAccounts] = await Promise.all([
      tryList(token, `${inspection.me.id}/businesses`, BUSINESS_FIELDS, warnings),
      tryList(token, `${inspection.me.id}/adaccounts`, AD_ACCOUNT_FIELDS, warnings),
    ]);
    if (graphBusinesses.ok) {
      businessRows.push(...graphBusinesses.rows.map((row) => ({ ...row, sources: ['graph_accounts' as const] })));
    }
    if (graphAccounts.ok) {
      adRows.push(...graphAccounts.rows.map((row) => mapAdAccount(row, 'graph_accounts')));
    }
    actorGraphUsable = graphBusinesses.ok || graphAccounts.ok;
  }

  // Luôn merge session với Graph: Graph có thể trả danh sách hợp lệ nhưng thiếu một
  // số BM/TKQC hoặc field billing mà HTML session đang có quyền hiển thị.
  businessRows.push(...inspection.businesses.map((business) => ({
    id: business.id,
    name: business.name,
    verification_status: business.verificationStatus,
    timezone_id: business.timezoneId,
    account_capacity: business.accountCapacity,
    ad_account_count: business.adAccountCount,
    owned_ad_account_count: business.ownedAdAccountCount,
    page_count: business.pageCount,
    business_country_code: business.country,
    created_time: business.createdTime,
    updated_time: business.updatedTime,
    vertical: business.vertical,
    two_factor_type: business.twoFactorType,
    sources: ['session' as const],
  })));
  adRows.push(...inspection.adAccounts.map((account) => ({
    id: account.id,
    name: account.name,
    accountStatus: account.accountStatus,
    disableReason: account.disableReason,
    spendCap: account.spendCap,
    amountSpent: account.amountSpent,
    balance: account.balance,
    minDailyBudget: account.minDailyBudget,
    currency: account.currency,
    timezoneId: account.timezoneId,
    timezoneName: account.timezoneName,
    isPrepayAccount: account.isPrepayAccount,
    fundingSource: account.fundingSource,
    ownerId: account.ownerId,
    businessName: account.businessName,
    country: account.country,
    ownership: account.ownership,
    sources: ['session' as const],
    businessIds: account.businessIds || [],
  })));

  const actorId = validId(inspection.me.id);
  const pageIds = new Set(pageRows.map((row) => validId(row.id)).filter(Boolean));
  const businessesBase = mergeDiscoveredAssets(businessRows.map((row) => ({
    ...row,
    id: validId(row.id),
    name: text(row.name) || `BM ${validId(row.id)}`,
    sources: row.sources,
  }))).filter((row) => row.id && row.id !== actorId && !pageIds.has(row.id));

  const businessDetails = new Map<string, {
    ownedAds: SnapshotAdAccount[];
    clientAds: SnapshotAdAccount[];
    ownedPages: SnapshotPage[];
    clientPages: SnapshotPage[];
    pixels: SnapshotPixel[];
    ownedAdsReadable: boolean;
    clientAdsReadable: boolean;
    adAccountsReadable: boolean;
    pagesReadable: boolean;
    pixelsReadable: boolean;
  }>();

  if (token && actorGraphUsable) {
    for (let offset = 0; offset < businessesBase.length; offset += 4) {
      await Promise.all(businessesBase.slice(offset, offset + 4).map(async (business) => {
        const businessId = business.id;
        const [ownedAds, clientAds, ownedPages, clientPages, pixels] = await Promise.all([
          tryList(token, `${businessId}/owned_ad_accounts`, AD_ACCOUNT_FIELDS, warnings),
          tryList(token, `${businessId}/client_ad_accounts`, AD_ACCOUNT_FIELDS, warnings),
          tryList(token, `${businessId}/owned_pages`, PAGE_FIELDS, warnings),
          tryList(token, `${businessId}/client_pages`, PAGE_FIELDS, warnings),
          tryList(token, `${businessId}/adspixels`, PIXEL_FIELDS, warnings),
        ]);
        businessDetails.set(businessId, {
          ownedAds: ownedAds.rows.map((row) => mapAdAccount(row, 'bm_owned', businessId)),
          clientAds: clientAds.rows.map((row) => mapAdAccount(row, 'bm_client', businessId)),
          ownedPages: ownedPages.rows.map((row) => mapPage(row, 'bm_owned', businessId)),
          clientPages: clientPages.rows.map((row) => mapPage(row, 'bm_client', businessId)),
          pixels: pixels.rows.map((row) => ({
            id: validId(row.id),
            name: text(row.name) || `Pixel ${validId(row.id)}`,
            creationTime: text(row.creation_time) || undefined,
            lastFiredTime: text(row.last_fired_time) || undefined,
            sources: ['bm_owned'],
            businessIds: [businessId],
          })),
          ownedAdsReadable: ownedAds.ok,
          clientAdsReadable: clientAds.ok,
          adAccountsReadable: ownedAds.ok && clientAds.ok,
          pagesReadable: ownedPages.ok && clientPages.ok,
          pixelsReadable: pixels.ok,
        });
      }));
    }
  }

  for (const detail of businessDetails.values()) {
    adRows.push(...detail.ownedAds, ...detail.clientAds);
    pageRows.push(...detail.ownedPages, ...detail.clientPages);
    pixelRows.push(...detail.pixels);
  }

  const adAccounts = mergeDiscoveredAssets(adRows.map((row) => ({ ...row, id: validId(row.id) }))).filter((row) => (
    row.id && row.id !== actorId && !pageIds.has(row.id)
  )).map((row) => ({
    ...row,
    businessIds: [...new Set(row.businessIds || [])],
  }));
  const pages = mergeDiscoveredAssets(pageRows.map((row) => ({ ...row, id: validId(row.id) }))).filter((row) => (
    row.id && row.id !== actorId
  )).map((row) => ({
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
    const sessionAds = adRows.filter((account) => account.businessIds.includes(business.id));
    const sessionPages = pageRows.filter((page) => page.businessIds.includes(business.id));
    const businessAds = mergeDiscoveredAssets([...(detail?.ownedAds || []), ...(detail?.clientAds || []), ...sessionAds]);
    const ownedAds = mergeDiscoveredAssets([
      ...(detail?.ownedAds || []),
      ...sessionAds.filter((account) => account.ownership === 'owned' || account.ownerId === business.id),
    ]);
    const businessPages = mergeDiscoveredAssets([...(detail?.ownedPages || []), ...(detail?.clientPages || []), ...sessionPages]);
    const currencies = aggregateCurrencies(businessAds.map((account) => account.currency));
    const reportedAdCount = optionalNumber(businessRecord.ad_account_count);
    const reportedOwnedAdCount = optionalNumber(businessRecord.owned_ad_account_count);
    const reportedPageCount = optionalNumber(businessRecord.page_count);
    // Session HTML can expose a subset of linked resources (for example the selected
    // ad account) without exposing the total. Only publish a count when Meta returned
    // an explicit count or a Graph edge was read successfully.
    const adAccountCount = reportedAdCount
      ?? (detail?.adAccountsReadable ? businessAds.length : null);
    const pageCount = reportedPageCount
      ?? (detail?.pagesReadable ? businessPages.length : null);
    const ownedAdAccountCount = reportedOwnedAdCount
      ?? (detail?.ownedAdsReadable ? ownedAds.length : null);
    const classification = bmClassification(
      capacityValue(business),
      adAccountCount || 0,
      ownedAdAccountCount,
      ownedAds.length,
    );
    const primaryPage = objectValue(businessRecord.primary_page);
    const profileFields = [
      businessRecord.verification_status,
      businessRecord.timezone_id,
      businessRecord.created_time,
      businessRecord.vertical,
    ].filter((value) => text(value)).length;
    const hasSpecificName = Boolean(business.name && !new RegExp(`^(?:BM|Business)\\s+${business.id}$`, 'i').test(business.name));
    const countsComplete = adAccountCount !== null && pageCount !== null;
    const detailsStatus = countsComplete && (profileFields > 0 || hasSpecificName)
      ? 'complete'
      : profileFields || hasSpecificName || adAccountCount !== null || pageCount !== null
        ? 'partial'
        : 'unavailable';
    return {
      id: business.id,
      name: business.name,
      verificationStatus: text(businessRecord.verification_status) || undefined,
      timezoneId: text(businessRecord.timezone_id) || undefined,
      createdTime: text(businessRecord.created_time) || undefined,
      updatedTime: text(businessRecord.updated_time) || undefined,
      vertical: text(businessRecord.vertical) || undefined,
      twoFactorType: text(businessRecord.two_factor_type) || undefined,
      country: text(businessRecord.business_country_code).toUpperCase() || undefined,
      primaryPage: validId(primaryPage.id) ? { id: validId(primaryPage.id), name: text(primaryPage.name) } : undefined,
      adAccountIds: businessAds.map((account) => account.id),
      pageIds: businessPages.map((page) => page.id),
      pixelIds: detail?.pixels.map((pixel) => pixel.id) || [],
      ...classification,
      adAccountCount,
      ownedAdAccountCount,
      pageCount,
      observedAdAccountCount: businessAds.length,
      observedOwnedAdAccountCount: ownedAds.length,
      observedPageCount: businessPages.length,
      detailsStatus,
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
