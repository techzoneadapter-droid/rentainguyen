export type NamedAsset = { id: string; name: string };

export type ExtractedSessionAssets = {
  businesses: NamedAsset[];
  adAccounts: NamedAsset[];
  pages: NamedAsset[];
};

function decodeHtml(value: string) {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\"/g, '"')
    .replace(/&/g, '&')
    .replace(/"/g, '"');
}

function uniqueNamed(rows: NamedAsset[]) {
  const map = new Map<string, NamedAsset>();
  for (const row of rows) {
    if (!/^\d{10,30}$/.test(row.id)) continue;
    const current = map.get(row.id);
    if (!current || (row.name && row.name !== row.id && (!current.name || current.name === current.id || current.name.startsWith('BM ') || current.name.startsWith('Ad account ')))) {
      map.set(row.id, row);
    }
  }
  return [...map.values()];
}

function nearbyName(html: string, index: number, id: string) {
  const window = html.slice(Math.max(0, index - 220), index + 260);
  const match = window.match(/"name"\s*:\s*"([^"]{1,160})"/);
  const name = match?.[1] ? decodeHtml(match[1]) : '';
  if (!name || name === id || /^ID \d+$/.test(name)) return '';
  return name;
}

function collect(html: string, pattern: RegExp, idIndex = 1) {
  const rows: NamedAsset[] = [];
  for (const match of html.matchAll(pattern)) {
    const id = match[idIndex];
    if (!id) continue;
    rows.push({ id, name: nearbyName(html, match.index || 0, id) });
  }
  return rows;
}

function adAccountFromLooseAccountId(html: string) {
  const rows: NamedAsset[] = [];
  for (const match of html.matchAll(/"account_id"\s*:\s*"(\d{10,30})"/g)) {
    const context = html.slice(Math.max(0, (match.index || 0) - 160), (match.index || 0) + 200).toLowerCase();
    if (!/adaccount|ad_account|account_status|amount_spent|disable_reason|"currency"/.test(context)) continue;
    if (/\b(user_id|profile_id|page_id|business_id)\b/.test(context) && !/adaccount|ad_account|account_status/.test(context)) continue;
    rows.push({ id: match[1], name: nearbyName(html, match.index || 0, match[1]) });
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

  const businesses = surface === 'ads'
    ? []
    : uniqueNamed([
      ...collect(html, /"__typename"\s*:\s*"Business"[\s\S]{0,280}?"id"\s*:\s*"(\d{10,30})"/g),
      ...collect(html, /"id"\s*:\s*"(\d{10,30})"[\s\S]{0,280}?"__typename"\s*:\s*"Business"/g),
      ...collect(html, /"(?:business_id|businessId)"\s*:\s*"(\d{10,30})"/g),
      ...collect(html, /[?&]business_id=(\d{10,30})/g),
    ]);

  const adAccounts = surface === 'business'
    ? []
    : uniqueNamed([
      ...collect(html, /"__typename"\s*:\s*"AdAccount"[\s\S]{0,300}?"id"\s*:\s*"(?:act_)?(\d{10,30})"/g),
      ...collect(html, /"id"\s*:\s*"(?:act_)?(\d{10,30})"[\s\S]{0,300}?"__typename"\s*:\s*"AdAccount"/g),
      ...collect(html, /"(?:adAccountId|ad_account_id)"\s*:\s*"(?:act_)?(\d{10,30})"/g),
      ...adAccountFromLooseAccountId(html),
    ]);

  const pages = surface === 'ads'
    ? []
    : uniqueNamed([
      ...collect(html, /"__typename"\s*:\s*"Page"[\s\S]{0,280}?"id"\s*:\s*"(\d{10,30})"/g),
      ...collect(html, /"id"\s*:\s*"(\d{10,30})"[\s\S]{0,280}?"__typename"\s*:\s*"Page"/g),
      ...collect(html, /"(?:page_id|pageId)"\s*:\s*"(\d{10,30})"/g),
    ]);

  return reconcileSessionAssets({ businesses, adAccounts, pages }, uid);
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
