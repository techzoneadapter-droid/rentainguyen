import { metaOAuthDialogUrl } from '../../../../lib/meta-oauth';

function redirectHome(req: Request, kind: 'error', message: string) {
  const url = new URL('/', req.url);
  url.searchParams.set('metaOauth', kind);
  url.searchParams.set('message', message);
  return Response.redirect(url, 302);
}

export async function GET(req: Request) {
  try {
    const stateBytes = crypto.getRandomValues(new Uint8Array(24));
    const state = Array.from(stateBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const oauthUrl = metaOAuthDialogUrl(req, state);
    const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';

    return new Response(null, {
      status: 302,
      headers: {
        Location: oauthUrl.toString(),
        'Set-Cookie': `meta_oauth_state=${state}; Path=/api/meta-oauth; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return redirectHome(req, 'error', (error as Error).message);
  }
}
