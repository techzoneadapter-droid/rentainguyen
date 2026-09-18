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
  category?: string;
  verificationStatus?: string;
  followersCount?: number;
  fanCount?: number;
  link?: string;
  businessIds?: string[];
  sources?: Array<'graph_accounts' | 'session' | 'bm_owned' | 'bm_client'>;
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
  title?: string;
  retryable?: boolean;
  body?: GraphBody;

  constructor(message: string, options: { code?: number; subcode?: number; httpStatus?: number; title?: string; retryable?: boolean; body?: GraphBody } = {}) {
    super(message);
    this.name = 'MetaTokenError';
    this.code = options.code;
    this.subcode = options.subcode;
    this.httpStatus = options.httpStatus;
    this.title = options.title;
    this.retryable = options.retryable;
    this.body = options.body;
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
    title: body.error?.error_user_title,
    retryable: body.error?.is_transient === true || response.status === 429 || response.status >= 500,
    body,
  });
}

/**
 * Graph client token-only. Session/extension token (Power Editor, Ads Manager)
 * thường fail GET /me với 190 Error loading application. Retry unversioned + user-id.
 */
function workerEnv() {
  return env as unknown as Record<string, string | undefined>;
}

function metaAppAccessToken() {
  const runtime = workerEnv();
  const appId = runtime.META_APP_ID || process.env.META_APP_ID || '';
  const appSecret = runtime.META_APP_SECRET || process.env.META_APP_SECRET || '';
  if (appId && appSecret) return `${appId}|${appSecret}`;
  return '';
}

const graphAppLoadUntil = new Map<string, { until: number; error: MetaTokenError }>();

export function isAppLoadError(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const code = error instanceof MetaTokenError ? error.code : undefined;
  return /error loading application|cannot load application|error validating application|application has been deleted/.test(message)
    || ((code === 1 || code === 100 || code === 190) && /application/.test(message));
}

export function isGraphCompatibilityError(error: unknown) {
  if (isAppLoadError(error)) return true;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const code = error instanceof MetaTokenError ? error.code : undefined;
  return code === 1 && /invalid request|request could not be processed|unknown error/.test(message);
}

function graphTokenKey(token: string) {
  return `${token.slice(0, 18)}:${token.length}:${token.slice(-10)}`;
}

export function isGraphTokenBlocked(token: string) {
  const hit = graphAppLoadUntil.get(graphTokenKey(token));
  return Boolean(hit && hit.until > Date.now());
}

function rememberAppLoad(token: string, error: unknown) {
  if (!isAppLoadError(error)) return;
  const meta = error instanceof MetaTokenError
    ? error
    : new MetaTokenError(error instanceof Error ? error.message : 'Error loading application', { code: 190, httpStatus: 400 });
  graphAppLoadUntil.set(graphTokenKey(token), { until: Date.now() + 120000, error: meta });
}

function blockedGraphError(token: string) {
  return graphAppLoadUntil.get(graphTokenKey(token))?.error;
}

export function graphEdge(userId: string, edge: string) {
  return `${userId}/${edge.replace(/^\//, '')}`;
}

const UA_WEB = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const UA_FB = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.43 Mobile Safari/537.36 [FBAN/FB4A;FBAV/10.0.0.1.70;]';

type GraphCallStyle = {
  version: string;
  mode: 'get-query' | 'post-get' | 'oauth-header' | 'form-post';
  ua: string;
};

async function metaRequestOnce(
  token: string,
  path: string,
  method: 'GET' | 'POST',
  params: Record<string, string>,
  style: GraphCallStyle,
) {
  const cleanPath = path.replace(/^\//, '');
  const prefix = style.version ? `${style.version}/` : '';
  const url = new URL(`https://graph.facebook.com/${prefix}${cleanPath}`);
  const headers: Record<string, string> = { 'User-Agent': style.ua };
  const options: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(25000),
  };

  if (style.mode === 'form-post' || (method === 'POST' && style.mode !== 'post-get')) {
    const body = new URLSearchParams(params);
    body.set('access_token', token);
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    options.method = 'POST';
    options.body = body;
  } else if (style.mode === 'post-get') {
    const body = new URLSearchParams(params);
    body.set('access_token', token);
    body.set('method', 'get');
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    options.method = 'POST';
    options.body = body;
  } else {
    // Token KHÔNG bao giờ nằm trong URL (query) — chỉ đi qua header Authorization,
    // tránh bị log/audit/proxy ghi lại. oauth-header cũng vậy: một header duy nhất.
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set('format', 'json');
    headers.Authorization = style.mode === 'oauth-header' ? `OAuth ${token}` : `Bearer ${token}`;
    options.method = 'GET';
  }

  const response = await fetch(url, options);
  const body = (await response.json().catch(() => ({}))) as GraphBody;
  if (!response.ok || body.error) throw makeMetaError(response, body);
  return body;
}

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

  const blocked = blockedGraphError(token);
  if (blocked) throw blocked;

  const version = config().version;
  const attempts: GraphCallStyle[] = method === 'GET'
    ? [
        { version, mode: 'get-query', ua: UA_WEB },
        { version, mode: 'post-get', ua: UA_WEB },
        { version: '', mode: 'get-query', ua: UA_FB },
        { version: '', mode: 'post-get', ua: UA_FB },
        { version: '', mode: 'oauth-header', ua: UA_WEB },
      ]
    : [
        { version, mode: 'form-post', ua: UA_WEB },
        { version: '', mode: 'form-post', ua: UA_FB },
      ];

  let lastError: unknown;
  for (let index = 0; index < attempts.length; index += 1) {
    try {
      const body = await metaRequestOnce(token, path, method, params, attempts[index]);
      // A session/extension token may fail on the versioned URL but succeed on the
      // compatibility URL. Do not leave that token blocked after a successful fallback.
      graphAppLoadUntil.delete(graphTokenKey(token));
      return body;
    } catch (error) {
      lastError = error;
      rememberAppLoad(token, error);
      const canRetry = index < attempts.length - 1 && isGraphCompatibilityError(error);
      if (!canRetry) throw error;
    }
  }
  throw lastError;
}

export function graphWithToken(token: string, path: string, params: Record<string, string> = {}) {
  return metaRequest(token, path, 'GET', params);
}

export async function graphListActor(token: string, userId: string | undefined, edge: string, fields: string, maxPages = 12) {
  const targets = [
    userId && /^\d{5,30}$/.test(userId) ? graphEdge(userId, edge) : '',
    `me/${edge.replace(/^\//, '')}`,
  ].filter(Boolean);
  let lastError: unknown;
  for (const path of targets) {
    try {
      return await graphListWithToken(token, path, fields, maxPages);
    } catch (error) {
      lastError = error;
      if (!isAppLoadError(error) && targets.indexOf(path) === targets.length - 1) throw error;
    }
  }
  if (lastError) throw lastError;
  return [];
}

export function graphPostWithToken(token: string, path: string, params: Record<string, string>) {
  return metaRequest(token, path, 'POST', params);
}

export async function graphListWithToken(token: string, path: string, fields: string, maxPages = 12) {
  const rows: MetaObject[] = [];
  let after = '';
  for (let page = 0; page < maxPages; page += 1) {
    const response = await graphWithToken(token, path, {
      ...(fields ? { fields } : {}),
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
  const cleaned = cleanMetaToken(token);

  function parse(body: GraphBody): TokenDebugInfo {
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
  }

  try {
    return parse(await graphWithToken(cleaned, 'debug_token', { input_token: cleaned }));
  } catch {
    const appToken = metaAppAccessToken();
    if (!appToken) return null;
    try {
      return parse(await graphWithToken(appToken, 'debug_token', { input_token: cleaned }));
    } catch {
      return null;
    }
  }
}

async function readActorProfile(token: string, userId: string) {
  const body = await graphWithToken(token, userId, { fields: 'id,name' });
  return { id: text(body.id) || userId, name: text(body.name) || `Meta User ${userId}` };
}

export async function inspectUserToken(rawToken: string): Promise<TokenInspection> {
  const token = cleanMetaToken(rawToken);
  const warnings: string[] = [];
  const debug = await debugUserToken(token);
  if (isGraphTokenBlocked(token) && debug?.isValid && debug.userId) {
    return {
      debug,
      me: { id: debug.userId, name: `Meta User ${debug.userId}` },
      permissions: uniqueScopes(debug.scopes),
      pages: [],
      warnings: ['Graph blocked Error loading application. Dùng debug_token (scopes + user id), không retry /me.'],
    };
  }

  let meId = '';
  let meName = '';
  let sessionCompat = false;

  if (debug?.isValid && debug.userId && /^\d{5,30}$/.test(debug.userId)) {
    try {
      const profile = await readActorProfile(token, debug.userId);
      meId = profile.id;
      meName = profile.name;
    } catch (error) {
      if (isAppLoadError(error) || (error instanceof MetaTokenError && error.code === 190)) {
        sessionCompat = true;
        meId = debug.userId;
        meName = `Meta User ${debug.userId}`;
        warnings.push('Session/extension token: Graph từ chối đọc profile (Error loading application). Dùng debug_token.user_id và gọi /{user-id}/… với quyền sẵn có trên token.');
      } else {
        throw error;
      }
    }
  }

  if (!meId) {
    try {
      const meBody = await graphWithToken(token, 'me', { fields: 'id,name' });
      meId = text(meBody.id);
      meName = text(meBody.name);
    } catch (error) {
      if (debug?.isValid && debug.userId && /^\d{5,30}$/.test(debug.userId) && isAppLoadError(error)) {
        sessionCompat = true;
        meId = debug.userId;
        meName = `Meta User ${debug.userId}`;
        warnings.push('GET /me bị Error loading application. Bỏ alias /me, dùng user id từ debug_token.');
      } else {
        throw error;
      }
    }
  }

  if (!/^\d{5,30}$/.test(meId)) {
    if (debug && !debug.isValid) {
      throw new MetaTokenError('Meta debug_token trả về is_valid=false.', { code: 190, httpStatus: 400 });
    }
    throw new MetaTokenError('Không lấy được User ID từ debug_token hoặc /me.', { code: 100, httpStatus: 400 });
  }

  const actor = meId;

  let permissions: string[] = uniqueScopes(debug?.scopes);
  if (!permissions.length && !isGraphTokenBlocked(token)) {
    try {
      const rows = await graphListWithToken(token, graphEdge(actor, 'permissions'), 'permission,status', 2);
      permissions = uniqueScopes(
        rows.filter((row) => text(row.status).toLowerCase() === 'granted').map((row) => text(row.permission)),
      );
    } catch (error) {
      warnings.push(`permissions: ${classifyMetaTokenError(error).reason}`);
    }
  }

  let pages: ManagedPage[] = [];
  if (!isGraphTokenBlocked(token)) {
    try {
      let rows: MetaObject[];
      try {
        rows = await graphListWithToken(token, graphEdge(actor, 'accounts'), 'id,name,category,verification_status,followers_count,fan_count,link,tasks', 4);
      } catch (error) {
        const fieldError = error instanceof MetaTokenError && [100, 200].includes(error.code || -1);
        if (!fieldError) throw error;
        rows = await graphListWithToken(token, graphEdge(actor, 'accounts'), 'id,name,tasks', 4);
        warnings.push('accounts: một số field Page mở rộng không được cấp; đã dùng id, name và tasks.');
      }
      const map = new Map<string, ManagedPage>();
      for (const row of rows) {
        const id = text(row.id);
        if (!/^\d{5,30}$/.test(id)) continue;
        map.set(id, {
          id,
          name: text(row.name) || 'Facebook Page',
          tasks: Array.isArray(row.tasks) ? row.tasks.map(String) : [],
          category: text(row.category) || undefined,
          verificationStatus: text(row.verification_status) || undefined,
          followersCount: Number(row.followers_count || 0) || undefined,
          fanCount: Number(row.fan_count || 0) || undefined,
          link: text(row.link) || undefined,
        });
      }
      pages = Array.from(map.values());
    } catch (error) {
      warnings.push(`accounts: ${classifyMetaTokenError(error).reason}`);
    }
  }

  if (sessionCompat) {
    warnings.push('Token đang chạy ở chế độ session/extension: không dùng OAuth dialog, gọi thẳng Graph bằng access_token và user id.');
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
    primaryPage?: string;
    timezoneId: number | string;
    requireListedPage?: boolean;
  },
): Promise<CreatedBusiness> {
  const token = cleanMetaToken(rawToken);
  const inspection = await inspectUserToken(token);
  const selectedPage = input.primaryPage ? inspection.pages.find((page) => page.id === input.primaryPage) : undefined;

  if (input.primaryPage && input.requireListedPage !== false && !selectedPage && inspection.pages.length) {
    throw new MetaTokenError('Page đã chọn không nằm trong GET /me/accounts của token.', { code: 100, httpStatus: 400 });
  }

  const payload: Record<string, string> = {
    name: input.name,
    vertical: input.vertical,
    timezone_id: String(input.timezoneId),
  };
  if (input.primaryPage && /^\d{5,30}$/.test(input.primaryPage)) payload.primary_page = input.primaryPage;

  const created = await graphPostWithToken(token, `${inspection.me.id}/businesses`, payload);

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
      id: text(primaryPage.id) || input.primaryPage || '',
      name: text(primaryPage.name) || selectedPage?.name || input.primaryPage || '',
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

/**
 * Meta trả error_subcode 1690114 khi tài khoản tạo đủ số Business Manager.
 * Một số bối cảnh Graph chỉ trả message, nên kiểm tra cả hai.
 */
export function looksLikeBusinessLimit(message: string, subcode?: number) {
  if (subcode === 1690114) return true;
  const lower = String(message || '').toLowerCase();
  return /business.{0,80}(limit|maximum|too many|cannot create|can't create|can not create|not eligible)|(limit|maximum).{0,80}business|reached.{0,40}business|not eligible.{0,40}business|đã đạt giới hạn.{0,40}(business|doanh nghiệp)/.test(lower);
}
