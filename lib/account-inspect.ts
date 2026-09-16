import { TOKEN_FULL_SCOPES, uniqueScopes } from './meta-scopes';
import { inspectCookieSession } from './meta-session';
import {
  debugUserToken,
  inspectUserToken,
  isAppLoadError,
  isGraphTokenBlocked,
  type ManagedPage,
  type TokenInspection,
} from './meta-tokens';

export type AccountInspection = TokenInspection & {
  source: 'graph' | 'cookie' | 'mixed';
  businesses: Array<{ id: string; name: string; verificationStatus?: string }>;
  adAccounts: Array<{ id: string; name: string; accountStatus?: number }>;
  workingToken?: string;
  cookieAlive?: boolean;
};

function asPages(rows: Array<{ id: string; name: string; tasks?: string[] }>): ManagedPage[] {
  return rows.map((row) => ({ id: row.id, name: row.name, tasks: row.tasks || [] }));
}

function mergeNamed<T extends { id: string; name: string }>(current: T[], extra: T[]) {
  const map = new Map(current.map((row) => [row.id, row]));
  for (const row of extra) {
    if (!row.id) continue;
    const existing = map.get(row.id);
    if (!existing || (row.name && existing.name === existing.id)) map.set(row.id, row);
  }
  return [...map.values()];
}

export async function inspectAccount(input: { token?: string; cookie?: string }): Promise<AccountInspection> {
  const token = String(input.token || '').trim();
  const cookie = String(input.cookie || '').trim();
  const warnings: string[] = [];

  const graphTask = token
    ? inspectUserToken(token).catch((error: unknown) => {
        warnings.push(`Graph token: ${(error as Error).message}`);
        if (!cookie && !isAppLoadError(error)) throw error;
        return null;
      })
    : Promise.resolve(null);

  const cookieTask = cookie
    ? inspectCookieSession(cookie).catch((error: unknown) => {
        warnings.push(`Cookie session: ${(error as Error).message}`);
        return null;
      })
    : Promise.resolve(null);

  const [graph, session] = await Promise.all([graphTask, cookieTask]);
  if (session) warnings.push(...session.warnings);

  let workingToken = token || undefined;
  let permissions = uniqueScopes(graph?.permissions);
  if (session?.tokens.length && (!permissions.length || isGraphTokenBlocked(token))) {
    const probe = session.tokens.find((item) => item !== token) || session.tokens[0];
    const debug = await debugUserToken(probe);
    if (debug?.isValid) {
      permissions = uniqueScopes(permissions, debug.scopes);
      workingToken = probe;
    }
  }

  if (graph) {
    let merged = uniqueScopes(permissions, graph.permissions);
    if (!merged.length && session?.alive) merged = uniqueScopes(TOKEN_FULL_SCOPES);
    return {
      ...graph,
      permissions: merged,
      pages: graph.pages.length ? graph.pages : asPages(session?.pages || []),
      warnings: [...graph.warnings, ...warnings].filter((item, index, array) => array.indexOf(item) === index).slice(0, 12),
      source: session ? 'mixed' : 'graph',
      businesses: session?.businesses || [],
      adAccounts: session?.adAccounts || [],
      workingToken,
      cookieAlive: session?.alive,
    };
  }

  if (session?.alive) {
    if (!permissions.length) {
      permissions = uniqueScopes(TOKEN_FULL_SCOPES);
      warnings.push('Graph không đọc me/permissions. Hiển thị bộ quyền Ads/BM/Page chuẩn của session Power Editor.');
    }
    return {
      debug: null,
      me: { id: session.uid, name: session.name },
      permissions,
      pages: asPages(session.pages),
      warnings: [
        ...warnings,
        'Graph 190 Error loading application. Check bằng cookie session; không đánh DIE/API không nhận.',
      ].slice(0, 12),
      source: 'cookie',
      businesses: session.businesses,
      adAccounts: session.adAccounts,
      workingToken,
      cookieAlive: true,
    };
  }

  throw new Error(warnings[0] || 'Không check được token Graph và không có cookie session sống.');
}