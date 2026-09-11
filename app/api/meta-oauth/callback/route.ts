import { audit, db, owner, put } from '../../../../lib/server';
import {
  META_OAUTH_SCOPES,
  exchangeForLongLivedMetaToken,
  exchangeMetaOAuthCode,
} from '../../../../lib/meta-oauth';
import {
  encryptToken,
  getMetaTokens,
  graphWithToken,
  tokenFingerprint,
  type MetaTokenRecord,
} from '../../../../lib/meta-tokens';

type MetaObject = Record<string, unknown>;

function cookieValue(req: Request, name: string) {
  const cookie = req.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}

function redirectHome(req: Request, kind: 'success' | 'error', message: string) {
  const url = new URL('/', req.url);
  url.searchParams.set('metaOauth', kind);
  url.searchParams.set('message', message);
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': `meta_oauth_state=; Path=/api/meta-oauth; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
      'Cache-Control': 'no-store',
    },
  });
}

function objectValue(value: unknown): MetaObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as MetaObject : {};
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const expectedState = cookieValue(req, 'meta_oauth_state');
  const actualState = url.searchParams.get('state') || '';
  const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error_message') || '';

  if (oauthError) return redirectHome(req, 'error', `Facebook không cấp quyền: ${oauthError}`);
  if (!expectedState || !actualState || expectedState !== actualState) {
    return redirectHome(req, 'error', 'Phiên kết nối Facebook không hợp lệ hoặc đã hết hạn. Hãy thử lại.');
  }

  const code = url.searchParams.get('code') || '';
  if (!code) return redirectHome(req, 'error', 'Facebook không trả mã OAuth.');

  try {
    const shortLived = await exchangeMetaOAuthCode(req, code);
    let accessToken = shortLived.access_token || '';
    let tokenLifetime = 'short-lived';

    try {
      const longLived = await exchangeForLongLivedMetaToken(req, accessToken);
      if (longLived.access_token) {
        accessToken = longLived.access_token;
        tokenLifetime = 'long-lived';
      }
    } catch {
      // A valid short-lived token is still useful; do not fail the OAuth connection only because extension failed.
    }

    const [meBody, permissionsBody] = await Promise.all([
      graphWithToken(accessToken, 'me', { fields: 'id,name' }),
      graphWithToken(accessToken, 'me/permissions'),
    ]);

    const metaUserId = String(meBody.id || '');
    const metaUserName = String(meBody.name || 'Facebook user');
    if (!/^\d{5,30}$/.test(metaUserId)) {
      throw new Error('Meta không trả về User ID hợp lệ sau OAuth.');
    }

    const permissions = Array.isArray(permissionsBody.data)
      ? permissionsBody.data.map(objectValue)
      : [];
    const granted = new Set(
      permissions
        .filter((item) => String(item.status || '') === 'granted')
        .map((item) => String(item.permission || '')),
    );
    const missing = META_OAUTH_SCOPES.filter((scope) => !granted.has(scope));
    if (missing.length) {
      throw new Error(`Tài khoản chưa cấp đủ quyền cần thiết: ${missing.join(', ')}.`);
    }

    const workspaceOwner = await owner();
    const existing = (await getMetaTokens(workspaceOwner)).find((item) => item.metaUserId === metaUserId);
    const now = new Date().toISOString();
    const encrypted = await encryptToken(accessToken);
    const fingerprint = await tokenFingerprint(accessToken);

    const record: MetaTokenRecord = existing
      ? {
          ...existing,
          label: existing.label || `${metaUserName} · OAuth`,
          encrypted,
          fingerprint,
          status: 'active',
          updated: now,
          metaUserId,
          metaUserName,
          lastCheckedAt: now,
          lastError: undefined,
          lastErrorCode: undefined,
          lastErrorSubcode: undefined,
        }
      : {
          id: crypto.randomUUID(),
          label: `${metaUserName} · OAuth`,
          encrypted,
          fingerprint,
          status: 'active',
          created: now,
          updated: now,
          metaUserId,
          metaUserName,
          lastCheckedAt: now,
        };

    await db().batch([
      put(workspaceOwner, 'meta-token', record),
      audit(workspaceOwner, `${existing ? 'Làm mới' : 'Kết nối'} token qua Facebook OAuth: ${metaUserName}`),
    ]);

    return redirectHome(
      req,
      'success',
      `Đã kết nối ${metaUserName} và lưu token ${tokenLifetime === 'long-lived' ? 'dài hạn' : 'hiện tại'} vào kho.`,
    );
  } catch (error) {
    return redirectHome(req, 'error', (error as Error).message);
  }
}
