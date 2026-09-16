import { inspectAccount } from './account-inspect';
import type { Asset } from './data';
import { inspectCookieSession } from './meta-session';
import {
  graphPostWithToken,
  graphWithToken,
  isAppLoadError,
  isGraphTokenBlocked,
  type MetaObject,
} from './meta-tokens';

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
  pageCount: number;
  userCount: number;
  shareLimit: string;
  kind: string;
};

const TIMEZONE_COUNTRY: Record<string, string> = {
  '1': 'US', '2': 'US', '4': 'US', '5': 'US', '6': 'US', '7': 'US', '8': 'US', '9': 'US', '10': 'US',
  '29': 'GB', '33': 'FR', '34': 'DE', '37': 'NL', '42': 'AU',
  '64': 'VN', '65': 'PH', '66': 'SG', '67': 'TH', '68': 'MY', '69': 'TW', '70': 'KR', '71': 'JP',
  '73': 'AU', '75': 'VN', '79': 'IN', '94': 'CN', '110': 'ID', '140': 'VN',
};

function text(value: unknown) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function objectValue(value: unknown): MetaObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as MetaObject : {};
}

function countData(value: unknown) {
  const body = objectValue(value);
  const summary = objectValue(body.summary);
  const total = Number(summary.total_count || 0);
  if (total) return total;
  return Array.isArray(body.data) ? body.data.length : 0;
}

export function countryFromTimezone(timezoneId?: string) {
  if (!timezoneId) return '';
  return TIMEZONE_COUNTRY[String(timezoneId)] || '';
}

export function classifyBmKind(adAccountCount: number, pageCount: number) {
  if (adAccountCount === 0 && pageCount === 0) return 'BM trắng';
  if (adAccountCount === 0) return 'BM0';
  if (adAccountCount <= 10) return `BM${adAccountCount}`;
  return `BM${adAccountCount}`;
}

export function classifyBmLevel(shareLimit?: number | string) {
  const value = Number(shareLimit || 0);
  if ([1, 5, 20, 50, 250, 350].includes(value)) return `BM${value}`;
  return '';
}

function parseShareLimit(source: string) {
  const match = source.match(/(?:up to|tối đa|maximum of|limit(?:ed)? to)\s*(\d{1,4})\s*(?:ad accounts|tài khoản)/i)
    || source.match(/\b(50|350|250|20|5)\s*ad accounts/i);
  return match ? Number(match[1]) : 0;
}

export function applyBmProfile(asset: Asset, profile: Partial<BmProfile>): Asset {
  const adAccountCount = profile.adAccountCount ?? Number(asset.adAccountCount || 0);
  const pageCount = profile.pageCount ?? Number(asset.pageCount || 0);
  const kind = profile.kind || classifyBmKind(adAccountCount, pageCount);
  const shareLimit = profile.shareLimit || asset.limit || 'Chưa rõ';
  const country = profile.country || countryFromTimezone(profile.timezoneId || asset.timezoneId) || asset.country || 'Chưa rõ';
  return {
    ...asset,
    name: profile.name || asset.name,
    verificationStatus: profile.verificationStatus || asset.verificationStatus,
    verified: (profile.verificationStatus || asset.verificationStatus || '').toLowerCase() === 'verified',
    timezoneId: profile.timezoneId || asset.timezoneId,
    country,
    tier: kind,
    limit: shareLimit || asset.limit || 'Chưa rõ',
    adAccountCount,
    pageCount,
    userCount: profile.userCount ?? asset.userCount,
    primaryPageId: profile.primaryPageId || asset.primaryPageId,
    primaryPageName: profile.primaryPageName || asset.primaryPageName,
    createdById: profile.createdById || asset.createdById,
    createdByName: profile.createdByName || asset.createdByName,
    creationTime: profile.createdTime || asset.creationTime,
  };
}

export async function readBmProfile(token: string, businessId: string): Promise<BmProfile> {
  const body = await graphWithToken(token, businessId, {
    fields: [
      'id,name,created_time,verification_status,timezone_id,vertical,link,two_factor_type',
      'primary_page{id,name,location{country,city,country_code}}',
      'created_by{id,name}',
      'owned_ad_accounts.limit(50){id,name,account_status,currency}',
      'client_ad_accounts.limit(50){id,name,account_status}',
      'owned_pages.limit(50){id,name}',
      'client_pages.limit(50){id,name}',
      'business_users.limit(50){id,name,role}',
    ].join(','),
  });
  const primary = objectValue(body.primary_page);
  const location = objectValue(primary.location);
  const createdBy = objectValue(body.created_by);
  const adAccountCount = countData(body.owned_ad_accounts) + countData(body.client_ad_accounts);
  const pageCount = countData(body.owned_pages) + countData(body.client_pages);
  const userCount = countData(body.business_users);
  const timezoneId = text(body.timezone_id);
  const country = text(location.country_code) || text(location.country) || countryFromTimezone(timezoneId) || 'Chưa rõ';
  return {
    name: text(body.name) || `BM ${businessId}`,
    timezoneId,
    country,
    verificationStatus: text(body.verification_status) || 'unknown',
    vertical: text(body.vertical),
    createdTime: text(body.created_time),
    primaryPageId: text(primary.id),
    primaryPageName: text(primary.name),
    createdById: text(createdBy.id),
    createdByName: text(createdBy.name),
    adAccountCount,
    pageCount,
    userCount,
    shareLimit: 'Chưa rõ',
    kind: classifyBmKind(adAccountCount, pageCount),
  };
}

export async function createBusinessAccount(input: {
  token?: string;
  cookie?: string;
  name: string;
  vertical: string;
  timezoneId: number | string;
  primaryPage?: string;
}) {
  const inspection = await inspectAccount({ token: input.token, cookie: input.cookie });
  const userId = inspection.me.id;
  const graphToken = inspection.workingToken || input.token || '';
  const payload: Record<string, string> = {
    name: input.name,
    vertical: input.vertical,
    timezone_id: String(input.timezoneId),
  };
  if (input.primaryPage && /^\d{5,30}$/.test(input.primaryPage)) payload.primary_page = input.primaryPage;

  if (graphToken && !isGraphTokenBlocked(graphToken)) {
    try {
      const created = await graphPostWithToken(graphToken, `${userId}/businesses`, payload);
      const id = text(created.id);
      if (/^\d{5,30}$/.test(id)) {
        return { id, name: input.name, source: 'graph' as const, inspection };
      }
    } catch (error) {
      if (!input.cookie || (!isAppLoadError(error) && !/primary_page|page is required/i.test((error as Error).message))) {
        throw error;
      }
    }
  }

  if (input.cookie) {
    const session = await inspectCookieSession(input.cookie);
    const dtsg = session.dtsg;
    if (!dtsg) throw new Error('Cookie sống nhưng không lấy được fb_dtsg để tạo BM trắng.');
    const body = new URLSearchParams({
      av: session.uid,
      __user: session.uid,
      __a: '1',
      fb_dtsg: dtsg,
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: 'XFBBizWebCreateBusinessMutation',
      server_timestamps: 'true',
      variables: JSON.stringify({
        input: {
          name: input.name,
          timezone_id: Number(input.timezoneId) || 140,
          vertical: input.vertical,
          client_mutation_id: crypto.randomUUID(),
        },
      }),
    });
    const response = await fetch('https://business.facebook.com/api/graphql', {
      method: 'POST',
      headers: {
        Cookie: input.cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://business.facebook.com',
        Referer: 'https://business.facebook.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      body,
      signal: AbortSignal.timeout(20000),
    });
    const raw = await response.text();
    const id = raw.match(/"id"\s*:\s*"(\d{5,30})"/)?.[1] || '';
    if (!id) {
      throw new Error('Graph không nhận token session và cookie GraphQL chưa trả Business ID. Thử lại với cookie mới hoặc thêm Page nếu Meta bắt buộc.');
    }
    return { id, name: input.name, source: 'cookie' as const, inspection };
  }

  throw new Error('Không tạo được BM: token Graph bị Error loading application và không có cookie session.');
}
