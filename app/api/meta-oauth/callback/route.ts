import { audit, db, owner, put } from '../../../../lib/server';
import {
  META_OAUTH_REQUIRED_SCOPES,
  META_OAUTH_SCOPES,
  exchangeForLongLivedMetaToken,
  exchangeMetaOAuthCode,
} from '../../../../lib/meta-oauth';
import {
  encryptToken,
  getMetaTokens,
  inspectUserToken,
  tokenFingerprint,
  type MetaTokenRecord,
} from '../../../../lib/meta-tokens';

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

    const inspection = await inspectUserToken(accessToken);
    const metaUserId = inspection.me.id;
    const metaUserName = inspection.me.name || 'Facebook user';
    const granted = new Set(inspection.permissions);
    const missingRequired = META_OAUTH_REQUIRED_SCOPES.filter((scope) => !granted.has(scope));
    if (missingRequired.length) {
      throw new Error(`Tài khoản chưa cấp quyền bắt buộc: ${missingRequired.join(', ')}.`);
    }
    const missingOptional = META_OAUTH_SCOPES.filter((scope) => !granted.has(scope));

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

    const grantedList = Array.from(granted).sort().join(', ');
    const extraNote = missingOptional.length
      ? ` Đã lưu ${granted.size} quyền. Chưa cấp: ${missingOptional.join(', ')}.`
      : ` Đã lưu đủ ${granted.size} quyền Graph.`;

    return redirectHome(
      req,
      'success',
      `Đã kết nối ${metaUserName} và lưu token ${tokenLifetime === 'long-lived' ? 'dài hạn' : 'hiện tại'} vào kho.${extraNote} (${grantedList})`,
    );
  } catch (error) {
    return redirectHome(req, 'error', (error as Error).message);
  }
}
