import { env } from 'cloudflare:workers';
import { uniqueScopes } from './meta-scopes';
import { config, list, put } from './server';

export type MetaTokenStatus =
  | 'active'
  | 'invalid'
  | 'permission_issue'
  | 'rate_limited'
  | 'create_restricted'
  | 'unknown_error';

export type MetaTokenRecord = {
  id: string;
  label: string;
  encrypted: string;
  fingerprint: string;
  status: MetaTokenStatus;
  created: string;
  updated: string;
  metaUserId?: string;
  metaUserName?: string;
  lastCheckedAt?: string;
  lastUsedAt?: string;
  lastCreateAt?: string;
  lastCreateResult?: string;
  lastError?: string;
  lastErrorCode?: number;
  lastErrorSubcode?: number;
};

export type PublicMetaToken = Omit<MetaTokenRecord, 'encrypted'>;

export type GraphBody = {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    is_transient?: boolean;
  };
  data?: unknown;
  paging?: { cursors?: { after?: string }; next?: string };
  [key: string]: unknown;
};

export type MetaObject = Record<string, unknown>;

export type TokenDebugInfo = {
  isValid: boolean;
  userId: string;
  appId: string;
  type: string;
  scopes: string[];
  expiresAt?: number;
};

export type ManagedPage = {
  id: string;
  name: string;
  tasks: string[];
};

export type TokenInspection = {
  debug: TokenDebugInfo | null;
  me: { id: string; name: string };
  permissions: string[];
  pages: ManagedPage[];
  warnings: string[];
};

export type CreatedBusiness = {
  id: string;
  name: string;
  verificationStatus: string;
  verified: boolean;
  createdTime: string;
  timezoneId: string;
  primaryPage: { id: string; name: string };
  createdBy: { id: string; name: string };
  raw: MetaObject;
  inspection: TokenInspection;
};

export class MetaTokenError extends Error {
  code?: number;
  subcode?: number;
  httpStatus?: number;

  constructor(message: string, options: { code?: number; subcode?: number; httpStatus?: number } = {}) {
    super(message);
    this.name = 'MetaTokenError';
    this.code = options.code;
    this.subcode = options.subcode;
    this.httpStatus = options.httpStatus;
  }
}

function vaultSecret() {
  const workerEnv = env as unknown as Record<string, string | undefined>;
  const secret = workerEnv.TOKEN_ENCRYPTION_KEY || process.env.TOKEN_ENCRYPTION_KEY || '';
  if (secret.length < 24) {
    throw new Error('Thiếu TOKEN_ENCRYPTION_KEY. Hãy đặt một chuỗi ngẫu nhiên ít nhất 24 ký tự trong .env.local rồi khởi động lại app.');
  }
  return secret;
}

async function aesKey() {
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(vaultSecret()));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function cleanMetaToken(value: string) {
  return String(value || '')
    .replace(/^\s*Bearer\s+/i, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function objectValue(value: unknown): MetaObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as MetaObject : {};
}

function text(value: unknown) {
  return value === undefined || value === null ? '' : String(value).trim();
}

export async function encryptToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await aesKey(),
    new TextEncoder().encode(cleanMetaToken(token)),
  );
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptToken(value: string) {
  const [ivText, cipherText] = value.split('.');
  if (!ivText || !cipherText) throw new Error('Dữ liệu token đã lưu không hợp lệ.');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(ivText) },
    await aesKey(),
    base64ToBytes(cipherText),
  );
  return cleanMetaToken(new TextDecoder().decode(plain));
}

export async function tokenFingerprint(token: string) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cleanMetaToken(token))));
  return Array.from(hash.slice(0, 6), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function publicToken(record: MetaTokenRecord): PublicMetaToken {
  const { encrypted, ...safe } = record;
  void encrypted;
  return safe;
}

export async function getMetaTokens(user: string) {
  return (await list(user, 'meta-token')) as MetaTokenRecord[];
}

export async function getMetaTokenRecord(user: string, id: string) {
  const token = (await getMetaTokens(user)).find((item) => item.id === id);
  if (!token) throw new Error('Không tìm thấy token nguồn trong workspace.');
  return token;
}

export async function getMetaTokenSecret(user: string, id: string) {
  const record = await getMetaTokenRecord(user, id);
  return { record, token: await decryptToken(record.encrypted) };
}

export async function updateMetaToken(
  user: string,
  record: MetaTokenRecord,
  patch: Partial<MetaTokenRecord>,
) {
  const next: MetaTokenRecord = {
    ...record,
    ...patch,
    id: record.id,
    encrypted: record.encrypted,
    updated: new Date().toISOString(),
  };
  await put(user, 'meta-token', next).run();
  return next;
}

function makeMetaError(response: Response, body: GraphBody) {
  const code = body.error?.code || response.status;
  const subcode = body.error?.error_subcode;
  const details = [
    body.error?.error_user_title?.trim(),
    body.error?.error_user_msg?.trim(),
    body.error?.message?.trim(),
  ].filter((value): value is string => Boolean(value));
  const detail = [...new Set(details)].join(' — ') || 'Meta không trả về dữ liệu hợp lệ.';
  const suffix = subcode ? `/${subcode}` : '';
  return new MetaTokenError(`Meta ${code}${suffix}: ${detail}`, {
    code,
    subcode,
    httpStatus: response.status,
  });
}

/**
 * Graph client token-only: gắn access_token trên query (GET) hoặc form body (POST).
 * Không cookie, không OAuth dialog, không Authorization Bearer.
 */
async function metaRequest(
  rawToken: string,
  path: string,
  method: 'GET' | 'POST',
  params: Record<string, string>,
) {
  const token = cleanMetaToken(rawToken);
  if (token.length < 20) {
    throw new MetaTokenError('Token trống hoặc quá ngắn sau khi làm sạch.', { code: 400, httpStatus: 400 });
  }

  const version = config().version;
  const url = new URL(`https://graph.facebook.com/${version}/${path.replace(/^\//, '')}`);
  const options: RequestInit = {
    method,
    signal: AbortSignal.timeout(25000),
  };

  if (method === 'GET') {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set('access_token', token);
  } else {
    const body = new URLSearchParams(params);
    body.set('access_token', token);
    options.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    options.body = body;
  }

  const response = await fetch(url, options);
  const body = (await response.json().catch(() => ({}))) as GraphBody;
  if (!response.ok || body.error) throw makeMetaError(response, body);
  return body;
}

export function graphWithToken(token: string, path: string, params: Record<string, string> = {}) {
  return metaRequest(token, path, 'GET', params);
}

export function graphPostWithToken(token: string, path: string, params: Record<string, string>) {
  return metaRequest(token, path, 'POST', params);
}

export async function graphListWithToken(token: string, path: string, fields: string, maxPages = 12) {
  const rows: MetaObject[] = [];
  let after = '';
  for (let page = 0; page < maxPages; page += 1) {
    const response = await graphWithToken(token, path, {
      fields,
      limit: '100',
      ...(after ? { after } : {}),
    });
    const pageRows = Array.isArray(response.data) ? response.data.map(objectValue) : [];
    rows.push(...pageRows);
    const cursor = text(objectValue(objectValue(response.paging).cursors).after);
    if (!cursor || pageRows.length === 0) break;
    after = cursor;
  }
  return rows;
}

export async function debugUserToken(token: string): Promise<TokenDebugInfo | null> {
  try {
    const body = await graphWithToken(token, 'debug_token', { input_token: cleanMetaToken(token) });
    const data = objectValue(body.data);
    const scopesRaw = data.scopes;
    const scopes = Array.isArray(scopesRaw)
      ? scopesRaw.map((item) => text(item)).filter(Boolean)
      : text(scopesRaw).split(',').map((item) => item.trim()).filter(Boolean);
    return {
      isValid: data.is_valid === true,
      userId: text(data.user_id),
      appId: text(data.app_id),
      type: text(data.type) || text(data.token_type),
      scopes,
      expiresAt: Number(data.expires_at || 0) || undefined,
    };
  } catch {
    return null;
  }
}

export async function inspectUserToken(rawToken: string): Promise<TokenInspection> {
  const token = cleanMetaToken(rawToken);
  const warnings: string[] = [];
  const debug = await debugUserToken(token);
  if (debug && !debug.isValid) {
    throw new MetaTokenError('Meta debug_token trả về is_valid=false.', { code: 190, httpStatus: 400 });
  }

  const meBody = await graphWithToken(token, 'me', { fields: 'id,name' });
  const meId = text(meBody.id);
  const meName = text(meBody.name);
  if (!/^\d{5,30}$/.test(meId)) {
    throw new MetaTokenError('Meta không trả về app-scoped User ID hợp lệ từ /me.', { code: 100, httpStatus: 400 });
  }

  let permissions: string[] = [];
  try {
    const rows = await graphListWithToken(token, 'me/permissions', 'permission,status', 5);
    permissions = rows
      .filter((row) => text(row.status).toLowerCase() === 'granted')
      .map((row) => text(row.permission))
      .filter(Boolean);
  } catch (error) {
    warnings.push(`me/permissions: ${classifyMetaTokenError(error).reason}`);
  }
  permissions = uniqueScopes(permissions, debug?.scopes);

  let pages: ManagedPage[] = [];
  try {
    const rows = await graphListWithToken(token, 'me/accounts', 'id,name,tasks');
    const map = new Map<string, ManagedPage>();
    for (const row of rows) {
      const id = text(row.id);
      if (!/^\d{5,30}$/.test(id)) continue;
      map.set(id, {
        id,
        name: text(row.name) || 'Facebook Page',
        tasks: Array.isArray(row.tasks) ? row.tasks.map(String) : [],
      });
    }
    pages = Array.from(map.values());
  } catch (error) {
    warnings.push(`me/accounts: ${classifyMetaTokenError(error).reason}`);
  }

  if (debug?.userId && debug.userId !== meId) {
    warnings.push(`debug_token.user_id (${debug.userId}) khác /me.id (${meId}). Dùng /me.id cho mọi call tạo tài nguyên.`);
  }

  return {
    debug,
    me: { id: meId, name: meName },
    permissions,
    pages,
    warnings,
  };
}

export async function createBusinessFromToken(
  rawToken: string,
  input: {
    name: string;
    vertical: string;
    primaryPage: string;
    timezoneId: number | string;
    requireListedPage?: boolean;
  },
): Promise<CreatedBusiness> {
  const token = cleanMetaToken(rawToken);
  const inspection = await inspectUserToken(token);
  const selectedPage = inspection.pages.find((page) => page.id === input.primaryPage);

  if (input.requireListedPage !== false && !selectedPage) {
    throw new MetaTokenError(
      inspection.pages.length
        ? 'Page đã chọn không nằm trong GET /me/accounts của token.'
        : 'Token hợp lệ nhưng GET /me/accounts không trả Page. Meta yêu cầu primary_page khi tạo BM.',
      { code: 100, httpStatus: 400 },
    );
  }

  if (inspection.permissions.length) {
    const missing = ['business_management', 'pages_show_list'].filter((permission) => !inspection.permissions.includes(permission));
    if (missing.length) {
      const error = new MetaTokenError(`Token thiếu quyền bắt buộc: ${missing.join(', ')}.`, { code: 200, httpStatus: 400 });
      error.name = 'MetaPermissionPreflightError';
      throw error;
    }
  }

  const created = await graphPostWithToken(token, `${inspection.me.id}/businesses`, {
    name: input.name,
    vertical: input.vertical,
    primary_page: input.primaryPage,
    timezone_id: String(input.timezoneId),
  });

  const businessId = text(created.id);
  if (!/^\d{5,30}$/.test(businessId)) {
    throw new MetaTokenError('Meta đã phản hồi nhưng không trả Business ID.', { code: 502, httpStatus: 502 });
  }

  let business: MetaObject = {};
  try {
    business = await graphWithToken(token, businessId, {
      fields: 'id,name,verification_status,created_time,timezone_id,primary_page,created_by',
    });
  } catch {
    business = { id: businessId, name: input.name };
  }

  const primaryPage = objectValue(business.primary_page);
  const createdBy = objectValue(business.created_by);
  const verificationStatus = text(business.verification_status) || 'unknown';

  return {
    id: businessId,
    name: text(business.name) || input.name,
    verificationStatus,
    verified: verificationStatus.toLowerCase() === 'verified',
    createdTime: text(business.created_time) || new Date().toISOString(),
    timezoneId: text(business.timezone_id) || String(input.timezoneId),
    primaryPage: {
      id: text(primaryPage.id) || input.primaryPage,
      name: text(primaryPage.name) || selectedPage?.name || input.primaryPage,
    },
    createdBy: {
      id: text(createdBy.id) || inspection.me.id,
      name: text(createdBy.name) || inspection.me.name,
    },
    raw: business,
    inspection,
  };
}

export function classifyMetaTokenError(error: unknown): {
  status: MetaTokenStatus;
  reason: string;
  code?: number;
  subcode?: number;
} {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const lower = rawMessage.toLowerCase();
  const code = error instanceof MetaTokenError ? error.code : undefined;
  const subcode = error instanceof MetaTokenError ? error.subcode : undefined;
  const clearlyExpired = /expired|invalidated|changed their password|session has expired|token has expired|access token.*expired|invalid oauth/.test(lower);
  const apiContextRejected =
    code === 1 ||
    ([100, 190].includes(code || -1) && /error loading application|invalid request|cannot load application|application.*load/.test(lower));

  let status: MetaTokenStatus = 'unknown_error';
  if (error instanceof Error && error.name === 'MetaPermissionPreflightError') {
    status = 'permission_issue';
  } else if (apiContextRejected && !clearlyExpired) {
    status = 'permission_issue';
  } else if (code === 190 || /access token.*(invalid|expired)|invalid oauth|session.*expired|token.*expired/.test(lower)) {
    status = 'invalid';
  } else if ([4, 17, 32, 613].includes(code || -1) || /rate limit|too many calls|request limit/.test(lower)) {
    status = 'rate_limited';
  } else if (
    subcode === 1690114 ||
    /đã đạt giới hạn số doanh nghiệp|giới hạn số doanh nghiệp|business.*(limit|maximum|too many|cannot create|can't create|not eligible)|(limit|maximum).*business|reached.*business|create.*business.*restricted|not eligible.*business/.test(lower)
  ) {
    status = 'create_restricted';
  } else if ([10, 200].includes(code || -1) || /permission|not authorized|requires.*access|insufficient.*access/.test(lower)) {
    status = 'permission_issue';
  }

  let reason = rawMessage;
  if (subcode === 1690114) {
    reason = `${rawMessage}. Tài khoản Meta đứng sau token hiện đã đạt giới hạn tạo Business. Token vẫn có thể dùng cho các thao tác được Meta cho phép; app sẽ không tự retry hoặc tự chuyển token.`;
  } else if (status === 'permission_issue' && (code === 1 || code === 190 || code === 100)) {
    reason = `${rawMessage}. App không kết luận token này là DIE. Meta đang từ chối bối cảnh gọi API hiện tại; token dạng extension/session có thể còn chạy trong Ads Manager nhưng không dùng được cho backend token-only.`;
  }

  return { status, reason, code, subcode };
}
