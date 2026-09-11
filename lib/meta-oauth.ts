import { env } from 'cloudflare:workers';
import { config } from './server';

type OAuthTokenBody = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; code?: number; error_subcode?: number };
};

export const META_OAUTH_SCOPES = [
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
] as const;

function workerEnv() {
  return env as unknown as Record<string, string | undefined>;
}

export function metaOAuthConfig(req: Request) {
  const runtime = workerEnv();
  const appId = runtime.META_APP_ID || process.env.META_APP_ID || '';
  const appSecret = runtime.META_APP_SECRET || process.env.META_APP_SECRET || '';
  const configuredRedirect = runtime.META_OAUTH_REDIRECT_URI || process.env.META_OAUTH_REDIRECT_URI || '';
  const origin = new URL(req.url).origin;
  const redirectUri = configuredRedirect || `${origin}/api/meta-oauth/callback`;

  if (!appId) throw new Error('Thiếu META_APP_ID trong .env.local.');
  if (!appSecret) throw new Error('Thiếu META_APP_SECRET trong .env.local.');

  return {
    appId,
    appSecret,
    redirectUri,
    version: config().version,
  };
}

export function metaOAuthDialogUrl(req: Request, state: string) {
  const oauth = metaOAuthConfig(req);
  const url = new URL(`https://www.facebook.com/${oauth.version}/dialog/oauth`);
  url.searchParams.set('client_id', oauth.appId);
  url.searchParams.set('redirect_uri', oauth.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', META_OAUTH_SCOPES.join(','));
  return url;
}

async function readOAuthBody(response: Response) {
  const body = (await response.json()) as OAuthTokenBody;
  if (!response.ok || body.error || !body.access_token) {
    const code = body.error?.code ? ` ${body.error.code}` : '';
    const subcode = body.error?.error_subcode ? `/${body.error.error_subcode}` : '';
    throw new Error(`Meta OAuth${code}${subcode}: ${body.error?.message || 'Không nhận được access token.'}`);
  }
  return body;
}

export async function exchangeMetaOAuthCode(req: Request, code: string) {
  const oauth = metaOAuthConfig(req);
  const url = new URL(`https://graph.facebook.com/${oauth.version}/oauth/access_token`);
  url.searchParams.set('client_id', oauth.appId);
  url.searchParams.set('client_secret', oauth.appSecret);
  url.searchParams.set('redirect_uri', oauth.redirectUri);
  url.searchParams.set('code', code);

  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  return readOAuthBody(response);
}

export async function exchangeForLongLivedMetaToken(req: Request, shortToken: string) {
  const oauth = metaOAuthConfig(req);
  const url = new URL(`https://graph.facebook.com/${oauth.version}/oauth/access_token`);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', oauth.appId);
  url.searchParams.set('client_secret', oauth.appSecret);
  url.searchParams.set('fb_exchange_token', shortToken);

  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  return readOAuthBody(response);
}
