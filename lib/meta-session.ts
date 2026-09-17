import { metaCookieUid, normalizeMetaCookie } from './credential-vault';
import {
  extractAssetsFromHtml,
  mergeExtractedAssets,
  reconcileSessionAssets,
  sessionSurfaceFromUrl,
  type ExtractedSessionAssets,
} from './session-extract';

export type SessionBusiness = { id: string; name: string; verificationStatus?: string };
export type SessionAdAccount = { id: string; name: string; accountStatus?: number };
export type SessionPage = { id: string; name: string; tasks: string[] };

export type CookieInspection = {
  alive: boolean;
  uid: string;
  name: string;
  dtsg: string;
  lsd: string;
  tokens: string[];
  businesses: SessionBusiness[];
  adAccounts: SessionAdAccount[];
  pages: SessionPage[];
  warnings: string[];
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const SESSION_URLS = [
  'https://www.facebook.com/',
  'https://business.facebook.com/settings',
  'https://adsmanager.facebook.com/adsmanager/manage/accounts',
];

function decodeHtml(value: string) {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\"/g, '"')
    .replace(/&/g, '&')
    .replace(/"/g, '"');
}

function isLoginHtml(url: string, html: string) {
  const lowerUrl = url.toLowerCase();
  if (/\/login\.php|\/login\/?(\?|$)|\/checkpoint\/|\/recover\//.test(lowerUrl)) return true;
  return /id="loginform"|name="email"[\s\S]{0,400}name="pass"|\/login\/identify/i.test(html) && !/"USER_ID"\s*:\s*"\d{5,}/.test(html);
}

export async function facebookFetch(cookie: string, url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cookie', normalizeMetaCookie(cookie));
  headers.set('User-Agent', UA);
  headers.set('Accept-Language', 'en-US,en;q=0.9,vi;q=0.8');
  if (!headers.has('Accept')) headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
  if (!headers.has('Sec-Fetch-Site')) headers.set('Sec-Fetch-Site', 'none');
  if (!headers.has('Sec-Fetch-Mode')) headers.set('Sec-Fetch-Mode', 'navigate');
  headers.set('Upgrade-Insecure-Requests', '1');
  const response = await fetch(url, {
    ...init,
    headers,
    redirect: 'follow',
    signal: init.signal || AbortSignal.timeout(8000),
  });
  const text = await response.text();
  return { response, text, url: response.url };
}

function extractTokens(html: string) {
  const found = new Set<string>();
  for (const match of html.matchAll(/"(?:accessToken|access_token)"\s*:\s*"(EAA[^"]+)"/g)) found.add(decodeHtml(match[1]));
  for (const match of html.matchAll(/EAA[A-Za-z0-9]{80,}/g)) found.add(match[0]);
  return [...found].filter((token) => token.length >= 80 && token.length <= 4096).slice(0, 8);
}

export function extractDtsg(html: string) {
  return (
    html.match(/"DTSGInitialData"[^[]*\[[^\]]*\{"token":"([^"]+)"/)?.[1]
    || html.match(/"token":"([A-Za-z0-9:_-]{8,})","async_get_token"/)?.[1]
    || html.match(/name="fb_dtsg"\s+value="([^"]+)"/)?.[1]
    || html.match(/\{"dtsg":\{"token":"([^"]+)"/)?.[1]
    || ''
  );
}

function extractLsd(html: string) {
  return html.match(/"LSD"[^[]*\[[^\]]*\{"token":"([^"]+)"/)?.[1]
    || html.match(/name="lsd"\s+value="([^"]+)"/)?.[1]
    || '';
}

function extractProfile(html: string, fallbackUid: string) {
  const uid = html.match(/"USER_ID"\s*:\s*"(\d{5,30})"/)?.[1] || fallbackUid;
  const name = decodeHtml(
    html.match(/"NAME"\s*:\s*"([^"]+)"/)?.[1]
    || html.match(/"fullName"\s*:\s*"([^"]+)"/)?.[1]
    || '',
  );
  return { uid, name: name || (uid ? `Meta User ${uid}` : '') };
}

function toSessionAssets(extracted: ExtractedSessionAssets) {
  return {
    businesses: extracted.businesses,
    adAccounts: extracted.adAccounts.map((row) => ({ ...row, accountStatus: 1 as const })),
    pages: extracted.pages.map((row) => ({ ...row, tasks: [] as string[] })),
  };
}

async function graphqlViewer(cookie: string, uid: string, dtsg: string) {
  if (!dtsg || !uid) return { businesses: [] as SessionBusiness[], adAccounts: [] as SessionAdAccount[], pages: [] as SessionPage[] };
  const body = new URLSearchParams({
    av: uid,
    __user: uid,
    __a: '1',
    fb_dtsg: dtsg,
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'BizKitSettingsBusinessListPaginationQuery',
    variables: JSON.stringify({ count: 50 }),
    server_timestamps: 'true',
  });
  const { text } = await facebookFetch(cookie, 'https://www.facebook.com/api/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: '*/*',
      Origin: 'https://www.facebook.com',
      Referer: 'https://www.facebook.com/',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'cors',
    },
    body,
  });
  return toSessionAssets(extractAssetsFromHtml(text, uid, 'graphql'));
}

export async function inspectCookieSession(rawCookie: string): Promise<CookieInspection> {
  const cookie = normalizeMetaCookie(rawCookie);
  const cookieUid = metaCookieUid(cookie);
  if (!cookieUid) {
    throw new Error('Cookie không có c_user. Session Facebook không hợp lệ.');
  }

  const warnings: string[] = [];
  let alive = false;
  let dtsg = '';
  let lsd = '';
  let name = '';
  let uid = cookieUid;
  const tokens: string[] = [];
  const parts: ExtractedSessionAssets[] = [];

  const results = await Promise.allSettled(SESSION_URLS.map((url) => facebookFetch(cookie, url)));
  for (const result of results) {
    if (result.status !== 'fulfilled') {
      warnings.push(`Cookie fetch: ${(result.reason as Error).message}`);
      continue;
    }
    const { text, url } = result.value;
    if (isLoginHtml(url, text)) {
      warnings.push(`Session bị đẩy về login: ${url}`);
      continue;
    }
    alive = true;
    const profile = extractProfile(text, uid);
    if (profile.uid) uid = profile.uid;
    if (profile.name && profile.name !== `Meta User ${profile.uid}`) name = profile.name;
    dtsg = dtsg || extractDtsg(text);
    lsd = lsd || extractLsd(text);
    for (const token of extractTokens(text)) {
      if (!tokens.includes(token)) tokens.push(token);
    }
    const surface = sessionSurfaceFromUrl(url);
    if (surface !== 'home') parts.push(extractAssetsFromHtml(text, uid, surface));
  }

  if (!alive) {
    throw new Error('Cookie Facebook không còn phiên sống. Facebook trả về trang đăng nhập/checkpoint.');
  }

  let extracted = reconcileSessionAssets(mergeExtractedAssets(parts), uid);

  if (dtsg && extracted.businesses.length === 0) {
    try {
      const extra = await graphqlViewer(cookie, uid, dtsg);
      extracted = reconcileSessionAssets(mergeExtractedAssets([extracted, extra]), uid);
    } catch (error) {
      warnings.push(`GraphQL session: ${(error as Error).message}`);
    }
  } else if (!dtsg) {
    warnings.push('Không lấy được fb_dtsg từ HTML session. Vẫn dùng dữ liệu nhúng trong trang Facebook.');
  }

  return {
    alive,
    uid,
    name: name || `Meta User ${uid}`,
    dtsg,
    lsd,
    tokens,
    businesses: extracted.businesses,
    adAccounts: extracted.adAccounts.map((row) => ({ ...row, accountStatus: 1 })),
    pages: extracted.pages.map((row) => ({ ...row, tasks: [] })),
    warnings,
  };
}
