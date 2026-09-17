import type { AccountSnapshot, StoredAccountSnapshot } from './account-snapshot';
import type { Asset } from './data';
import { MetaCreationError, toStructuredMetaError, type StructuredMetaError } from './meta-errors';
import { aggregateCurrencies, bmClassification, mergeDiscoveredAssets } from './resource-model';
import { extractDtsg, facebookFetch, inspectCookieSession } from './meta-session';
import { graphPostWithToken, graphWithToken, type MetaObject } from './meta-tokens';

export type BmProfile = {
  name: string;
  timezoneId: string;
  country: string;
  verificationStatus: string;
  vertical: string;
  createdTime: string;
  primaryPageId: string;
  primaryPageName: string;
  createdById: string;
  createdByName: string;
  adAccountCount: number;
  ownedAdAccountCount: number | null;
  pageCount: number;
  userCount: number;
  shareLimit: string;
  kind: string;
  bmType: string;
  accountCapacity: number | null;
  currencies: string[];
  currencyMode: 'SINGLE' | 'MULTI' | 'NONE';
  currency: string;
};

function text(value: unknown) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function objectValue(value: unknown): MetaObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as MetaObject : {};
}

function dataRows(value: unknown) {
  const body = objectValue(value);
  return Array.isArray(body.data) ? body.data.map(objectValue) : [];
}

/** Kept for compatibility: BM type is derived only from verified owned ad accounts. */
export function classifyBmKind(ownedAdAccountCount: number, _pageCount: number, accountCapacity?: number | null) {
  return bmClassification(accountCapacity, ownedAdAccountCount, ownedAdAccountCount, ownedAdAccountCount).bmType;
}

export function classifyBmLevel(shareLimit?: number | string) {
  const value = Number(shareLimit);
  return Number.isInteger(value) && value >= 0 ? `BM${value}` : '';
}

export function applyBmProfile(asset: Asset, profile: Partial<BmProfile>): Asset {
  const adAccountCount = profile.adAccountCount ?? asset.adAccountCount ?? null;
  const ownedAdAccountCount = profile.ownedAdAccountCount ?? asset.ownedAdAccountCount ?? null;
  const accountCapacity = profile.accountCapacity !== undefined && profile.accountCapacity !== null
    ? profile.accountCapacity
    : asset.accountCapacity ?? null;
  const profileType = profile.bmType && profile.bmType !== 'UNKNOWN' ? profile.bmType : profile.kind && profile.kind !== 'UNKNOWN' ? profile.kind : '';
  const derivedType = bmClassification(
    accountCapacity,
    adAccountCount ?? 0,
    ownedAdAccountCount,
    asset.observedOwnedAdAccountCount || 0,
  ).bmType;
  const bmType = profileType || derivedType;
  const country = profile.country || asset.country || 'Chưa đọc được';
  return {
    ...asset,
    name: profile.name || asset.name,
    verificationStatus: profile.verificationStatus || asset.verificationStatus,
    verified: (profile.verificationStatus || asset.verificationStatus || '').toLowerCase() === 'verified',
    timezoneId: profile.timezoneId || asset.timezoneId,
    country,
    tier: bmType,
    bmType,
    accountCapacity,
    limit: accountCapacity === null ? 'unknown' : String(accountCapacity),
    adAccountCount,
    ownedAdAccountCount,
    pageCount: profile.pageCount ?? asset.pageCount,
    userCount: profile.userCount ?? asset.userCount,
    currencies: profile.currencies || asset.currencies,
    currencyMode: profile.currencyMode || asset.currencyMode,
    currency: profile.currency || asset.currency,
    primaryPageId: profile.primaryPageId || asset.primaryPageId,
    primaryPageName: profile.primaryPageName || asset.primaryPageName,
    createdById: profile.createdById || asset.createdById,
    createdByName: profile.createdByName || asset.createdByName,
    creationTime: profile.createdTime || asset.creationTime,
  };
}

export async function readBmProfile(token: string, businessId: string): Promise<BmProfile> {
  const fieldGroups = [
    [
      'id,name,created_time,verification_status,timezone_id,vertical,business_country_code',
      'primary_page{id,name,location{country,city,country_code}}',
      'created_by{id,name}',
      'owned_ad_accounts.limit(100){id,name,account_status,currency}',
      'client_ad_accounts.limit(100){id,name,account_status,currency}',
      'owned_pages.limit(100){id,name}',
      'client_pages.limit(100){id,name}',
      'business_users.limit(100){id,name,role}',
    ].join(','),
    [
      'id,name,created_time,verification_status,timezone_id,vertical',
      'primary_page{id,name,location{country,city,country_code}}',
      'created_by{id,name}',
      'owned_ad_accounts.limit(100){id,name,account_status,currency}',
      'client_ad_accounts.limit(100){id,name,account_status,currency}',
      'owned_pages.limit(100){id,name}',
      'client_pages.limit(100){id,name}',
      'business_users.limit(100){id,name,role}',
    ].join(','),
  ];
  let body: MetaObject;
  try {
    body = await graphWithToken(token, businessId, { fields: fieldGroups[0] });
  } catch {
    body = await graphWithToken(token, businessId, { fields: fieldGroups[1] });
  }
  const primary = objectValue(body.primary_page);
  const createdBy = objectValue(body.created_by);
  const ownedAccounts = mergeDiscoveredAssets([
    ...dataRows(body.owned_ad_accounts).map((row) => ({ id: text(row.id).replace(/^act_/, ''), name: text(row.name), currency: text(row.currency), sources: ['bm_owned' as const] })),
  ]);
  const accounts = mergeDiscoveredAssets([
    ...ownedAccounts,
    ...dataRows(body.client_ad_accounts).map((row) => ({ id: text(row.id).replace(/^act_/, ''), name: text(row.name), currency: text(row.currency), sources: ['bm_client' as const] })),
  ]);
  const pages = mergeDiscoveredAssets([
    ...dataRows(body.owned_pages).map((row) => ({ id: text(row.id), name: text(row.name), sources: ['bm_owned' as const] })),
    ...dataRows(body.client_pages).map((row) => ({ id: text(row.id), name: text(row.name), sources: ['bm_client' as const] })),
  ]);
  const currency = aggregateCurrencies(accounts.map((account) => account.currency));
  const ownedAccountsReadable = Array.isArray(objectValue(body.owned_ad_accounts).data);
  const classification = bmClassification(
    null,
    accounts.length,
    ownedAccountsReadable ? ownedAccounts.length : null,
    ownedAccountsReadable ? ownedAccounts.length : 0,
  );
  const timezoneId = text(body.timezone_id);
  return {
    name: text(body.name) || `BM ${businessId}`,
    timezoneId,
    country: text(body.business_country_code).toUpperCase() || 'Chưa đọc được',
    verificationStatus: text(body.verification_status) || 'unknown',
    vertical: text(body.vertical),
    createdTime: text(body.created_time),
    primaryPageId: text(primary.id),
    primaryPageName: text(primary.name),
    createdById: text(createdBy.id),
    createdByName: text(createdBy.name),
    pageCount: pages.length,
    userCount: dataRows(body.business_users).length,
    shareLimit: 'unknown',
    kind: classification.bmType,
    ...classification,
    ...currency,
  };
}

function parseSessionBody(raw: string) {
  const cleaned = raw.replace(/^for \(;;\);\s*/, '').trim();
  try {
    return JSON.parse(cleaned) as MetaObject;
  } catch {
    return { message: cleaned.slice(0, 4000) || 'Meta session trả về body không phải JSON.' };
  }
}

function findBusinessId(value: unknown, parentKey = ''): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findBusinessId(item, parentKey);
      if (found) return found;
    }
    return '';
  }
  const object = objectValue(value);
  for (const [key, current] of Object.entries(object)) {
    if (/^(business_id|businessId)$/i.test(key) && /^\d{5,30}$/.test(text(current))) return text(current);
    if (key === 'id' && /business|biz/i.test(parentKey) && /^\d{5,30}$/.test(text(current))) return text(current);
  }
  for (const [key, current] of Object.entries(object)) {
    const found = findBusinessId(current, key);
    if (found) return found;
  }
  return '';
}

function graphqlErrorMessage(parsed: MetaObject, raw: string) {
  const listed = Array.isArray(parsed.errors) ? parsed.errors : [];
  const first = objectValue(listed[0]);
  return text(first.message)
    || text(objectValue(parsed.error).message)
    || text(parsed.message)
    || raw.replace(/^for \(;;\);\s*/, '').slice(0, 300)
    || 'Cookie GraphQL không trả Business ID.';
}

function createDocIds(html: string) {
  const ids = new Set<string>();
  const patterns = [
    /CreateBusiness[A-Za-z0-9_]*["']?\s*[:=,]\s*["'](\d{13,20})["']/g,
    /["'](\d{13,20})["'][^]{0,100}CreateBusiness/gi,
    /"doc_id"\s*:\s*"(\d{13,20})"[\s\S]{0,160}CreateBusiness/g,
    /CreateBusiness[\s\S]{0,160}"doc_id"\s*:\s*"(\d{13,20})"/g,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) ids.add(match[1]);
  }
  return [...ids];
}

export type PreparedSession = { uid: string; dtsg: string; tokens: string[] };

/**
 * Đọc cookie session đúng MỘT lần cho cả batch tạo BM: uid, fb_dtsg và các token
 * nhúng trong trang Facebook. Truyền kết quả này vào createBusinessAccount để
 * không phải fetch lại trang Facebook cho từng BM.
 */
export async function prepareCookieSession(cookie?: string): Promise<PreparedSession | null> {
  const cleaned = String(cookie || '').trim();
  if (!cleaned) return null;
  const inspection = await inspectCookieSession(cleaned).catch(() => null);
  if (!inspection?.alive) return null;
  return { uid: inspection.uid, dtsg: inspection.dtsg, tokens: inspection.tokens };
}

export async function createBusinessAccount(input: {
  token: string;
  cookie?: string;
  session?: PreparedSession | null;
  name: string;
  vertical: string;
  timezoneId: number | string;
  primaryPage?: string;
  snapshot: AccountSnapshot | StoredAccountSnapshot;
}) {
  const errors: StructuredMetaError[] = [];
  const payload: Record<string, string> = {
    name: input.name,
    vertical: input.vertical,
    timezone_id: String(input.timezoneId),
  };
  if (input.primaryPage && /^\d{5,30}$/.test(input.primaryPage)) payload.primary_page = input.primaryPage;

  const session = input.session !== undefined ? input.session : await prepareCookieSession(input.cookie);
  const graphTokens = [...new Set([input.token, ...(session?.tokens || [])].filter(Boolean))].slice(0, 3);

  for (const token of graphTokens) {
    try {
      const created = await graphPostWithToken(token, `${input.snapshot.actor.id}/businesses`, payload);
      const id = text(created.id);
      if (!/^\d{5,30}$/.test(id)) {
        throw { message: 'Meta Graph phản hồi nhưng không trả Business ID.', raw: created, httpStatus: 502, code: 502 };
      }
      return { id, name: input.name, source: 'graph' as const, snapshot: input.snapshot, errors };
    } catch (error) {
      errors.push(toStructuredMetaError(error, { source: 'graph', stage: 'graph_create' }));
    }
  }

  if (input.cookie && session) {
    try {
      if (!session.dtsg) throw new Error('Cookie sống nhưng không lấy được fb_dtsg.');
      const createPage = await facebookFetch(input.cookie, 'https://business.facebook.com/', {
        signal: AbortSignal.timeout(12000),
      }).catch(() => ({ text: '', url: '', response: undefined as unknown as Response }));
      const dtsg = extractDtsg(createPage.text) || session.dtsg;
      const docIds = createDocIds(createPage.text);
      const friendlyNames = [
        'XFBBizWebCreateBusinessMutation',
        'BizWebCreateBusinessMutation',
        'BusinessComposerCreateMutation',
        'BizKitSettingsBusinessCreationMutation',
      ];
      const sessionInput: Record<string, unknown> = {
        name: input.name,
        timezone_id: Number(input.timezoneId) || 140,
        vertical: input.vertical,
        creation_source: 'biz_web',
        client_mutation_id: crypto.randomUUID(),
      };
      if (input.primaryPage && /^\d{5,30}$/.test(input.primaryPage)) {
        sessionInput.primary_page_id = input.primaryPage;
      }

      const attempts: Array<{ friendly: string; docId?: string }> = [
        ...friendlyNames.map((friendly) => ({ friendly })),
        ...docIds.flatMap((docId) => friendlyNames.map((friendly) => ({ friendly, docId }))),
      ];

      let lastMessage = 'Cookie GraphQL không trả Business ID.';
      for (const attempt of attempts.slice(0, 12)) {
        const body = new URLSearchParams({
          av: session.uid,
          __user: session.uid,
          __a: '1',
          fb_dtsg: dtsg,
          fb_api_caller_class: 'RelayModern',
          fb_api_req_friendly_name: attempt.friendly,
          server_timestamps: 'true',
          variables: JSON.stringify({ input: sessionInput }),
        });
        if (attempt.docId) body.set('doc_id', attempt.docId);
        const response = await facebookFetch(input.cookie, 'https://business.facebook.com/api/graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: '*/*',
            Origin: 'https://business.facebook.com',
            Referer: 'https://business.facebook.com/',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Mode': 'cors',
          },
          body,
          signal: AbortSignal.timeout(20000),
        });
        const parsed = parseSessionBody(response.text);
        const id = findBusinessId(parsed) || response.text.match(/"id"\s*:\s*"(\d{10,30})"/)?.[1] || '';
        if (id) {
          return { id, name: input.name, source: 'session' as const, snapshot: input.snapshot, errors };
        }
        lastMessage = graphqlErrorMessage(parsed, response.text);
      }
      throw { message: lastMessage, body: { message: lastMessage }, httpStatus: 400 };
    } catch (error) {
      errors.push(toStructuredMetaError(error, { source: 'session', stage: 'session_create' }));
    }
  }

  if (!errors.length) {
    errors.push(toStructuredMetaError(new Error('Không có working credential để tạo BM.'), { source: 'app', stage: 'preflight', httpStatus: 400 }));
  }
  throw new MetaCreationError(errors);
}
