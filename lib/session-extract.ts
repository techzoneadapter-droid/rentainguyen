export type NamedAsset = {
  id: string;
  name: string;
  accountStatus?: number;
  disableReason?: number;
  currency?: string;
  amountSpent?: string;
  balance?: string;
  spendCap?: string;
  minDailyBudget?: string;
  timezoneId?: string;
  timezoneName?: string;
  isPrepayAccount?: boolean;
  fundingSource?: string;
  ownerId?: string;
  businessName?: string;
  country?: string;
  ownership?: 'owned' | 'client' | 'unknown';
  accountCapacity?: number;
  adAccountCount?: number;
  ownedAdAccountCount?: number;
  pageCount?: number;
  createdTime?: string;
  updatedTime?: string;
  vertical?: string;
  twoFactorType?: string;
  category?: string;
  verificationStatus?: string;
  followersCount?: number;
  fanCount?: number;
  link?: string;
  businessIds?: string[];
};

export type ExtractedSessionAssets = {
  businesses: NamedAsset[];
  adAccounts: NamedAsset[];
  pages: NamedAsset[];
};

function decodeHtml(value: string) {
  return value
    .replace(/\\+u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\+x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function uniqueNamed(rows: NamedAsset[]) {
  const map = new Map<string, NamedAsset>();
  for (const row of rows) {
    if (!/^\d{10,30}$/.test(row.id)) continue;
    const current = map.get(row.id);
    if (!current) {
      map.set(row.id, row);
      continue;
    }
    const defined = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined && value !== null && value !== ''));
    const currentGeneric = !current.name || current.name === current.id || /^(?:BM|Business|Ads|Ad account|Page|Pixel)\s+\d+$/i.test(current.name);
    const nextSpecific = Boolean(row.name && row.name !== row.id && !/^(?:BM|Business|Ads|Ad account|Page|Pixel)\s+\d+$/i.test(row.name));
    map.set(row.id, {
      ...current,
      ...defined,
      name: nextSpecific || currentGeneric ? row.name || current.name : current.name,
      businessIds: [...new Set([...(current.businessIds || []), ...(row.businessIds || [])])],
    });
  }
  return [...map.values()];
}

function objectWindow(html: string, index: number) {
  const start = html.lastIndexOf('{', index);
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let cursor = start; cursor < Math.min(html.length, start + 10000); cursor += 1) {
      const character = html[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) return { text: html.slice(start, cursor + 1), start };
      }
    }
  }
  const fallbackStart = Math.max(0, index - 500);
  return { text: html.slice(fallbackStart, index + 700), start: fallbackStart };
}

function nearbyScalar(html: string, index: number, key: string) {
  const window = objectWindow(html, index);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`"${escapedKey}"\\s*:\\s*(?:"((?:\\\\.|[^"\\\\])*)"|(-?\\d+(?:\\.\\d+)?)|(true|false|null))`, 'gi');
  let winner = '';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const match of window.text.matchAll(pattern)) {
    const absolute = window.start + (match.index || 0);
    const distance = Math.abs(absolute - index);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    winner = match[1] !== undefined ? decodeHtml(match[1]) : match[2] !== undefined ? match[2] : match[3] || '';
  }
  return winner;
}

function nearbyNestedId(html: string, index: number, key: string) {
  const window = objectWindow(html, index);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`"${escapedKey}"\\s*:\\s*(?:"(\\d{5,30})"|\\{[^{}]{0,500}?"id"\\s*:\\s*"(\\d{5,30})")`, 'gi');
  let winner = '';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const match of window.text.matchAll(pattern)) {
    const absolute = window.start + (match.index || 0);
    const distance = Math.abs(absolute - index);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    winner = match[1] || match[2] || '';
  }
  return winner;
}

function optionalNumber(value: string) {
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function resourceName(value: string, id: string) {
  const name = value.trim();
  if (!name || name === id || /^ID \d+$/i.test(name)) return '';
  if (/^(?:SETTINGS|BUSINESS SETTINGS|ADS MANAGER|META BUSINESS SUITE|ALL TOOLS|HOME|MONETIZATION|PEOPLE|PARTNERS|SYSTEM USERS|PAGES|AD ACCOUNTS|INSTAGRAM ACCOUNTS|WHATSAPP ACCOUNTS|PIXELS|DATASETS|DOMAINS|PAYMENT METHODS|SECURITY CENTER|REQUESTS|NOTIFICATIONS|BUSINESS INFO)$/i.test(name)) return '';
  return name;
}

function nearbyName(html: string, index: number, id: string) {
  const name = nearbyScalar(html, index, 'name');
  if (!name || name === id || /^ID \d+$/.test(name)) return '';
  return name;
}

function metadataNear(html: string, index: number, id: string): NamedAsset {
  const prepay = nearbyScalar(html, index, 'is_prepay_account');
  const ownedFlag = nearbyScalar(html, index, 'is_owned') || nearbyScalar(html, index, 'isOwned');
  const relationship = (
    nearbyScalar(html, index, 'relationship_type')
    || nearbyScalar(html, index, 'ownership_type')
    || nearbyScalar(html, index, 'asset_relationship')
    || nearbyScalar(html, index, 'business_object_relationship_to_business')
    || nearbyScalar(html, index, 'relationshipToBusiness')
  ).toLowerCase();
  const typename = nearbyScalar(html, index, '__typename').toLowerCase();
  const regularName = nearbyScalar(html, index, 'name');
  const name = typename === 'business'
    ? nearbyScalar(html, index, 'business_name') || nearbyScalar(html, index, 'businessName') || regularName
    : typename === 'adaccount'
      ? regularName || nearbyScalar(html, index, 'account_name')
      : typename === 'page'
        ? regularName || nearbyScalar(html, index, 'page_name')
        : regularName || nearbyScalar(html, index, 'business_name') || nearbyScalar(html, index, 'display_name');
  const capacity = [
    'account_capacity',
    'ad_account_capacity',
    'ad_account_limit',
    'owned_ad_account_limit',
  ].map((key) => optionalNumber(nearbyScalar(html, index, key))).find((value) => value !== undefined);
  const ownerId = (
    nearbyScalar(html, index, 'owner_business_id')
    || nearbyScalar(html, index, 'owning_business_id')
    || nearbyNestedId(html, index, 'business_owner')
    || nearbyNestedId(html, index, 'owning_business')
    || nearbyNestedId(html, index, 'owner')
    || nearbyNestedId(html, index, 'business')
  ).replace(/^act_/, '');
  const ownership = ownedFlag === 'true' || /^(?:owned|owner|direct)$/.test(relationship)
    ? 'owned'
    : ownedFlag === 'false' || /client|partner|shared|assigned/.test(relationship)
      ? 'client'
      : 'unknown';
  return {
    id,
    name: resourceName(name, id) || resourceName(nearbyName(html, index, id), id),
    accountStatus: optionalNumber(nearbyScalar(html, index, 'account_status')),
    disableReason: optionalNumber(nearbyScalar(html, index, 'disable_reason')),
    currency: nearbyScalar(html, index, 'currency').toUpperCase() || undefined,
    amountSpent: nearbyScalar(html, index, 'amount_spent') || undefined,
    balance: nearbyScalar(html, index, 'balance') || undefined,
    spendCap: nearbyScalar(html, index, 'spend_cap') || undefined,
    minDailyBudget: nearbyScalar(html, index, 'min_daily_budget') || undefined,
    timezoneId: nearbyScalar(html, index, 'timezone_id') || undefined,
    timezoneName: nearbyScalar(html, index, 'timezone_name') || undefined,
    isPrepayAccount: prepay === 'true' ? true : prepay === 'false' ? false : undefined,
    fundingSource: nearbyScalar(html, index, 'funding_source') || undefined,
    ownerId: /^\d{5,30}$/.test(ownerId) ? ownerId : undefined,
    businessName: nearbyScalar(html, index, 'business_name') || nearbyScalar(html, index, 'businessName') || undefined,
    country: (
      nearbyScalar(html, index, 'business_country_code')
      || nearbyScalar(html, index, 'country_code')
      || nearbyScalar(html, index, 'created_country')
    ).toUpperCase() || undefined,
    ownership,
    accountCapacity: capacity,
    adAccountCount: optionalNumber(nearbyScalar(html, index, 'ad_account_count')),
    ownedAdAccountCount: optionalNumber(nearbyScalar(html, index, 'owned_ad_account_count')),
    pageCount: optionalNumber(nearbyScalar(html, index, 'page_count') || nearbyScalar(html, index, 'owned_page_count')),
    createdTime: nearbyScalar(html, index, 'created_time') || undefined,
    updatedTime: nearbyScalar(html, index, 'updated_time') || undefined,
    vertical: nearbyScalar(html, index, 'vertical') || undefined,
    twoFactorType: nearbyScalar(html, index, 'two_factor_type') || undefined,
    category: nearbyScalar(html, index, 'category') || undefined,
    verificationStatus: nearbyScalar(html, index, 'verification_status') || undefined,
    followersCount: optionalNumber(nearbyScalar(html, index, 'followers_count')),
    fanCount: optionalNumber(nearbyScalar(html, index, 'fan_count')),
    link: nearbyScalar(html, index, 'link') || undefined,
  };
}

function collect(html: string, pattern: RegExp, idIndex = 1) {
  const rows: NamedAsset[] = [];
  for (const match of html.matchAll(pattern)) {
    const id = match[idIndex];
    if (!id) continue;
    rows.push(metadataNear(html, match.index || 0, id));
  }
  return rows;
}

function adAccountFromLooseAccountId(html: string) {
  const rows: NamedAsset[] = [];
  for (const match of html.matchAll(/"account_id"\s*:\s*"(\d{10,30})"/g)) {
    const context = html.slice(Math.max(0, (match.index || 0) - 160), (match.index || 0) + 200).toLowerCase();
    if (!/adaccount|ad_account|account_status|amount_spent|disable_reason|"currency"/.test(context)) continue;
    if (/\b(user_id|profile_id|page_id|business_id)\b/.test(context) && !/adaccount|ad_account|account_status/.test(context)) continue;
    rows.push(metadataNear(html, match.index || 0, match[1]));
  }
  return rows;
}

export function extractAssetsFromHtml(
  html: string,
  uid: string,
  surface: 'home' | 'business' | 'ads' | 'graphql',
): ExtractedSessionAssets {
  const empty: ExtractedSessionAssets = { businesses: [], adAccounts: [], pages: [] };
  if (!html || surface === 'home') return empty;
  const normalized = decodeHtml(html);

  const businesses = surface === 'ads'
    ? []
    : uniqueNamed([
      ...collect(normalized, /"__typename"\s*:\s*"Business"[\s\S]{0,280}?"id"\s*:\s*"(\d{10,30})"/g),
      ...collect(normalized, /"id"\s*:\s*"(\d{10,30})"[\s\S]{0,280}?"__typename"\s*:\s*"Business"/g),
      ...collect(normalized, /"(?:business_id|businessId)"\s*:\s*"(\d{10,30})"/g),
      ...collect(normalized, /[?&]business_id=(\d{10,30})/g),
    ]);

  const adAccounts = uniqueNamed([
      ...collect(normalized, /"__typename"\s*:\s*"AdAccount"[\s\S]{0,300}?"id"\s*:\s*"(?:act_)?(\d{10,30})"/g),
      ...collect(normalized, /"id"\s*:\s*"(?:act_)?(\d{10,30})"[\s\S]{0,300}?"__typename"\s*:\s*"AdAccount"/g),
      ...collect(normalized, /"(?:adAccountId|ad_account_id)"\s*:\s*"(?:act_)?(\d{10,30})"/g),
      ...(surface === 'business' ? [] : adAccountFromLooseAccountId(normalized)),
    ]);

  const pages = surface === 'ads'
    ? []
    : uniqueNamed([
      ...collect(normalized, /"__typename"\s*:\s*"Page"[\s\S]{0,280}?"id"\s*:\s*"(\d{10,30})"/g),
      ...collect(normalized, /"id"\s*:\s*"(\d{10,30})"[\s\S]{0,280}?"__typename"\s*:\s*"Page"/g),
      ...collect(normalized, /"(?:page_id|pageId)"\s*:\s*"(\d{10,30})"/g),
    ]);

  return reconcileSessionAssets({ businesses, adAccounts, pages }, uid);
}

export function extractBusinessProfileFromHtml(html: string, businessId: string) {
  if (!/^\d{5,30}$/.test(businessId)) return null;
  const normalized = decodeHtml(html);
  const escapedId = businessId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const candidates: Array<{ row: NamedAsset; score: number }> = [];
  const patterns = [
    { pattern: new RegExp(`"id"\\s*:\\s*"${escapedId}"`, 'g'), baseScore: 30 },
    { pattern: new RegExp(`"(?:business_id|businessId)"\\s*:\\s*"${escapedId}"`, 'g'), baseScore: 10 },
    { pattern: new RegExp(`[?&]business_id=${escapedId}`, 'g'), baseScore: 0 },
  ];
  for (const { pattern, baseScore } of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const index = match.index || 0;
      const context = objectWindow(normalized, index).text;
      const typedBusiness = /"__typename"\s*:\s*"Business"/i.test(context);
      const namedBusiness = /"(?:business_name|businessName)"\s*:/i.test(context);
      const profileMetadata = /"(?:account_capacity|ad_account_capacity|ad_account_count|page_count|verification_status|timezone_id|vertical|two_factor_type)"\s*:/i.test(context);
      const row = metadataNear(normalized, index, businessId);
      const menuLike = Boolean(row.name && /^[A-Z][A-Z\s/_-]{3,}$/.test(row.name) && !typedBusiness && !namedBusiness && !profileMetadata);
      if (menuLike) row.name = '';
      const populated = Object.values(row).filter((value) => value !== undefined && value !== null && value !== '').length;
      candidates.push({
        row,
        score: baseScore + (typedBusiness ? 100 : 0) + (namedBusiness ? 80 : 0) + (profileMetadata ? 60 : 0) + (row.name ? 20 : 0) + populated,
      });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((left, right) => right.score - left.score);
  const merged: NamedAsset = { id: businessId, name: '' };
  for (const { row } of candidates) {
    for (const [key, value] of Object.entries(row)) {
      if (value === undefined || value === null || value === '') continue;
      if (key === 'name') {
        if (!merged.name) merged.name = String(value);
        continue;
      }
      if ((merged as Record<string, unknown>)[key] === undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
  }
  return merged;
}

export function reconcileSessionAssets(
  assets: ExtractedSessionAssets,
  uid: string,
): ExtractedSessionAssets {
  const pages = uniqueNamed(assets.pages.filter((row) => row.id !== uid)).map((row) => ({
    ...row,
    name: row.name || `Page ${row.id}`,
  }));
  const pageIds = new Set(pages.map((row) => row.id));
  const businesses = uniqueNamed(assets.businesses.filter((row) => row.id !== uid && !pageIds.has(row.id))).map((row) => ({
    ...row,
    name: row.name || `BM ${row.id}`,
  }));
  const businessIds = new Set(businesses.map((row) => row.id));
  const adAccounts = uniqueNamed(assets.adAccounts.filter((row) => (
    row.id !== uid && !pageIds.has(row.id) && !businessIds.has(row.id)
  ))).map((row) => ({
    ...row,
    name: row.name || `Ad account ${row.id}`,
  }));
  return { businesses, adAccounts, pages };
}

export function protectKnownBusinesses(assets: ExtractedSessionAssets, businessIds: Iterable<string>): ExtractedSessionAssets {
  const known = new Set([...businessIds].filter(Boolean));
  return {
    businesses: assets.businesses,
    adAccounts: assets.adAccounts.filter((row) => !known.has(row.id)),
    pages: assets.pages.filter((row) => !known.has(row.id)),
  };
}

export function mergeExtractedAssets(parts: ExtractedSessionAssets[]) {
  return reconcileSessionAssets({
    businesses: parts.flatMap((part) => part.businesses),
    adAccounts: parts.flatMap((part) => part.adAccounts),
    pages: parts.flatMap((part) => part.pages),
  }, '');
}

export function sessionSurfaceFromUrl(url: string): 'home' | 'business' | 'ads' | 'graphql' {
  const lower = url.toLowerCase();
  if (/adsmanager|\/ads\/manager/.test(lower)) return 'ads';
  if (/business\.facebook\.com|\/business\//.test(lower)) return 'business';
  if (/\/api\/graphql/.test(lower)) return 'graphql';
  return 'home';
}
