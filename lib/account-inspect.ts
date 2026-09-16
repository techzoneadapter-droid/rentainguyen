import { uniqueScopes } from './meta-scopes';
import { inspectCookieSession } from './meta-session';
import {
  inspectUserToken,
  isAppLoadError,
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

export async function inspectAccount(input: { token?: string; cookie?: string }): Promise<AccountInspection> {
  const token = String(input.token || '').trim();
  const cookie = String(input.cookie || '').trim();
  const warnings: string[] = [];
  let graph: TokenInspection | null = null;
  let graphError: unknown;
  let workingToken = token || undefined;

  if (token) {
    try {
      graph = await inspectUserToken(token);
    } catch (error) {
      graphError = error;
      warnings.push(`Graph token: ${(error as Error).message}`);
      if (!cookie && !isAppLoadError(error)) throw error;
    }
  }

  const session = cookie
    ? await inspectCookieSession(cookie).catch((error: unknown) => {
        warnings.push(`Cookie session: ${(error as Error).message}`);
        if (!graph) throw graphError || error;
        return null;
      })
    : null;
  if (session) warnings.push(...session.warnings);

  if (!graph && session?.tokens.length) {
    for (const extracted of session.tokens) {
      if (extracted === token) continue;
      try {
        graph = await inspectUserToken(extracted);
        workingToken = extracted;
        warnings.push('Đã lấy access token Graph từ phiên cookie Facebook (không qua OAuth dialog).');
        break;
      } catch (error) {
        warnings.push(`Token nhúng từ session chưa gọi Graph được: ${(error as Error).message}`);
      }
    }
  }

  if (graph) {
    return {
      ...graph,
      permissions: uniqueScopes(graph.permissions),
      pages: graph.pages.length ? graph.pages : asPages(session?.pages || []),
      warnings: [...graph.warnings, ...warnings].filter((item, index, array) => array.indexOf(item) === index),
      source: session ? 'mixed' : 'graph',
      businesses: session?.businesses || [],
      adAccounts: session?.adAccounts || [],
      workingToken,
      cookieAlive: session?.alive,
    };
  }

  if (session?.alive) {
    return {
      debug: null,
      me: { id: session.uid, name: session.name },
      permissions: [],
      pages: asPages(session.pages),
      warnings: [
        ...warnings,
        'Token Graph bị Error loading application. Đã check tài nguyên bằng cookie session Facebook, không qua OAuth Meta.',
      ],
      source: 'cookie',
      businesses: session.businesses,
      adAccounts: session.adAccounts,
      workingToken,
      cookieAlive: true,
    };
  }

  if (graphError) throw graphError;
  throw new Error('Không có token Graph dùng được và không có cookie session sống để check tài nguyên.');
}
