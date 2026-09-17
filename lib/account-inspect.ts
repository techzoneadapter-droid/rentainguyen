import { TOKEN_FULL_SCOPES, uniqueScopes } from './meta-scopes';
import { inspectCookieSession } from './meta-session';
import { resolveAccountAvailability } from './resource-model';
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
  confirmedPermissions: string[];
  inferredPermissions: string[];
};

function asPages(
  rows: Array<{ id: string; name: string; tasks?: string[] }>,
  source: 'graph_accounts' | 'session',
): ManagedPage[] {
  return rows.map((row) => ({ id: row.id, name: row.name, tasks: row.tasks || [], sources: [source] }));
}

function mergePages(current: ManagedPage[], extra: ManagedPage[]) {
  const map = new Map(current.map((row) => [row.id, row] as const));
  for (const row of extra) {
    if (!row.id) continue;
    const existing = map.get(row.id);
    if (!existing) {
      map.set(row.id, row);
      continue;
    }
    map.set(row.id, {
      ...existing,
      ...(row.name && existing.name === existing.id ? row : {}),
      sources: [...new Set([...(existing.sources || []), ...(row.sources || [])])],
    });
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
  const availability = resolveAccountAvailability(Boolean(graph), Boolean(session?.alive));
  if (session) warnings.push(...session.warnings);

  let workingToken = token || undefined;
  let confirmedPermissions = uniqueScopes(graph?.permissions);
  if (session?.tokens.length && (!confirmedPermissions.length || isGraphTokenBlocked(token))) {
    const probe = session.tokens.find((item) => item !== token) || session.tokens[0];
    const debug = await debugUserToken(probe);
    if (debug?.isValid) {
      confirmedPermissions = uniqueScopes(confirmedPermissions, debug.scopes);
      workingToken = probe;
    }
  }

  const inferredPermissions = session?.alive
    ? uniqueScopes(TOKEN_FULL_SCOPES).filter((permission) => !confirmedPermissions.includes(permission))
    : [];
  const pages = mergePages(
    asPages(graph?.pages || [], 'graph_accounts'),
    asPages(session?.pages || [], 'session'),
  );

  if (graph) {
    confirmedPermissions = uniqueScopes(confirmedPermissions, graph.permissions);
    return {
      ...graph,
      permissions: confirmedPermissions,
      confirmedPermissions,
      inferredPermissions,
      pages,
      warnings: [...graph.warnings, ...warnings].filter((item, index, array) => array.indexOf(item) === index).slice(0, 20),
      source: availability.source === 'mixed' ? 'mixed' : 'graph',
      businesses: session?.businesses || [],
      adAccounts: session?.adAccounts || [],
      workingToken,
      cookieAlive: session?.alive,
    };
  }

  if (session?.alive) {
    if (!confirmedPermissions.length) {
      warnings.push('Graph không xác nhận được permission. Quyền từ cookie/session chỉ được đánh dấu là suy ra.');
    }
    return {
      debug: null,
      me: { id: session.uid, name: session.name },
      permissions: confirmedPermissions,
      confirmedPermissions,
      inferredPermissions,
      pages,
      warnings: [
        ...warnings,
        'Graph không đọc được tài khoản nhưng cookie session còn sống; trạng thái tài khoản vẫn là LIVE theo session.',
      ].slice(0, 20),
      source: 'cookie',
      businesses: session.businesses,
      adAccounts: session.adAccounts,
      workingToken,
      cookieAlive: true,
    };
  }

  throw new Error(warnings[0] || 'Không check được token Graph và không có cookie session sống.');
}
