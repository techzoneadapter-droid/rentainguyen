import { env } from 'cloudflare:workers';
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

type GraphBody = {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    is_transient?: boolean;
  };
  [key: string]: unknown;
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

export async function encryptToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await aesKey(),
    new TextEncoder().encode(token),
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
  return new TextDecoder().decode(plain);
}

export async function tokenFingerprint(token: string) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
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

async function metaRequest(
  token: string,
  path: string,
  method: 'GET' | 'POST',
  params: Record<string, string>,
) {
  const version = config().version;
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  const options: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(25000),
  };

  if (method === 'GET') {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  } else {
    options.headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    options.body = new URLSearchParams(params);
  }

  const response = await fetch(url, options);
  const body = (await response.json()) as GraphBody;
  if (!response.ok || body.error) throw makeMetaError(response, body);
  return body;
}

export function graphWithToken(token: string, path: string, params: Record<string, string> = {}) {
  return metaRequest(token, path, 'GET', params);
}

export function graphPostWithToken(token: string, path: string, params: Record<string, string>) {
  return metaRequest(token, path, 'POST', params);
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

  let status: MetaTokenStatus = 'unknown_error';
  if (
    code === 190 ||
    /access token.*(invalid|expired)|invalid oauth|session.*expired|token.*expired/.test(lower)
  ) {
    status = 'invalid';
  } else if (
    [4, 17, 32, 613].includes(code || -1) ||
    /rate limit|too many calls|request limit/.test(lower)
  ) {
    status = 'rate_limited';
  } else if (
    subcode === 1690114 ||
    /đã đạt giới hạn số doanh nghiệp|giới hạn số doanh nghiệp|business.*(limit|maximum|too many|cannot create|can't create|not eligible)|(limit|maximum).*business|reached.*business|create.*business.*restricted|not eligible.*business/.test(lower)
  ) {
    status = 'create_restricted';
  } else if (
    [10, 200].includes(code || -1) ||
    /permission|not authorized|requires.*access|insufficient.*access/.test(lower)
  ) {
    status = 'permission_issue';
  }

  let reason = rawMessage;
  if (subcode === 1690114) {
    reason = `${rawMessage}. Tài khoản Meta đứng sau token hiện đã đạt giới hạn tạo Business. Token vẫn có thể dùng cho các thao tác được Meta cho phép; app sẽ không tự retry hoặc tự chuyển token.`;
  }

  return { status, reason, code, subcode };
}
