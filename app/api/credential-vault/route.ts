import { z } from 'zod';
import { audit, db, list, owner, put } from '../../../lib/server';
import { redactSecrets } from '../../../lib/redact';
import type { MetaSessionRecord } from '../../../lib/credential-vault';
import { getMetaTokens, publicToken, type MetaTokenRecord } from '../../../lib/meta-tokens';

type TokenInventory = {
  tokenId: string;
  status?: string;
  metaUserId?: string;
  metaUserName?: string;
  businessCount?: number | null;
  pageCount?: number | null;
  adAccountCount?: number | null;
  lastError?: string;
  scannedAt?: string;
};

export type CredentialAccount = {
  id: string;
  label: string;
  uid: string;
  name: string;
  hasCookie: boolean;
  hasToken: boolean;
  sessionId?: string;
  tokenId?: string;
  cookieStatus?: MetaSessionRecord['status'];
  tokenStatus?: MetaTokenRecord['status'];
  lastError?: string;
  lastCheckedAt?: string;
  businessCount?: number | null;
  pageCount?: number | null;
  adAccountCount?: number | null;
  updated: string;
};

const renameSchema = z.object({
  action: z.literal('rename'),
  label: z.string().trim().min(1).max(80),
  sessionId: z.string().uuid().optional(),
  tokenId: z.string().uuid().optional(),
});

const deleteSchema = z.object({
  action: z.literal('delete'),
  sessionIds: z.array(z.string().uuid()).max(100).default([]),
  tokenIds: z.array(z.string().uuid()).max(100).default([]),
});

const requestSchema = z.discriminatedUnion('action', [renameSchema, deleteSchema]);

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

function deleteRecord(workspaceOwner: string, kind: string, id: string) {
  return db().prepare('DELETE FROM records WHERE owner = ? AND kind = ? AND id = ?').bind(workspaceOwner, kind, id);
}

function inventoryId(workspaceOwner: string, tokenId: string) {
  return `${workspaceOwner}:token-inventory:${tokenId}`;
}

function snapshotId(workspaceOwner: string, tokenId: string) {
  return `${workspaceOwner}:account-snapshot:${tokenId}`;
}

function buildAccounts(
  sessions: MetaSessionRecord[],
  tokens: ReturnType<typeof publicToken>[],
  inventories: TokenInventory[],
): CredentialAccount[] {
  const inventoryByToken = new Map(inventories.map((item) => [item.tokenId, item]));
  const usedSessions = new Set<string>();
  const accounts: CredentialAccount[] = [];

  for (const token of tokens) {
    const uid = token.metaUserId || '';
    const session = uid ? sessions.find((item) => item.uid === uid) : undefined;
    if (session) usedSessions.add(session.id);
    const inventory = inventoryByToken.get(token.id);
    const name = token.metaUserName || session?.metaUserName || token.label;
    accounts.push({
      id: session ? `pair:${token.id}` : `token:${token.id}`,
      label: token.label || session?.label || name,
      uid,
      name,
      hasCookie: Boolean(session),
      hasToken: true,
      sessionId: session?.id,
      tokenId: token.id,
      cookieStatus: session?.status,
      tokenStatus: token.status,
      lastError: session?.lastError || token.lastError || inventory?.lastError,
      lastCheckedAt: session?.lastCheckedAt || token.lastCheckedAt || inventory?.scannedAt,
      businessCount: session?.businessCount ?? inventory?.businessCount ?? null,
      pageCount: session?.pageCount ?? inventory?.pageCount ?? null,
      adAccountCount: session?.adAccountCount ?? inventory?.adAccountCount ?? null,
      updated: token.updated || session?.updated || token.created,
    });
  }

  for (const session of sessions) {
    if (usedSessions.has(session.id)) continue;
    accounts.push({
      id: `session:${session.id}`,
      label: session.label,
      uid: session.uid,
      name: session.metaUserName || session.label,
      hasCookie: true,
      hasToken: false,
      sessionId: session.id,
      cookieStatus: session.status,
      lastError: session.lastError,
      lastCheckedAt: session.lastCheckedAt,
      businessCount: session.businessCount ?? null,
      pageCount: session.pageCount ?? null,
      adAccountCount: session.adAccountCount ?? null,
      updated: session.updated || session.created,
    });
  }

  return accounts.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}

async function loadAccounts(workspaceOwner: string) {
  const [sessions, tokens, inventories] = await Promise.all([
    list(workspaceOwner, 'meta-session') as Promise<MetaSessionRecord[]>,
    getMetaTokens(workspaceOwner),
    list(workspaceOwner, 'token-inventory') as Promise<TokenInventory[]>,
  ]);
  return buildAccounts(sessions, tokens.map(publicToken), inventories);
}

export async function GET() {
  try {
    const workspaceOwner = await owner();
    const accounts = await loadAccounts(workspaceOwner);
    return Response.json({
      accounts,
      sessionCount: accounts.filter((item) => item.hasCookie).length,
      tokenCount: accounts.filter((item) => item.hasToken).length,
    });
  } catch (error) {
    return Response.json({ error: redactSecrets((error as Error).message) }, { status: 400 });
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: 'Ngu\u1ed3n y\u00eau c\u1ea7u kh\u00f4ng h\u1ee3p l\u1ec7.' }, { status: 403 });
  try {
    const workspaceOwner = await owner();
    const input = requestSchema.parse(await req.json());

    if (input.action === 'rename') {
      if (!input.sessionId && !input.tokenId) throw new Error('Thi\u1ebfu b\u1ea3n ghi \u0111\u1ec3 \u0111\u1ed5i t\u00ean.');
      if (input.sessionId) {
        const sessions = await list(workspaceOwner, 'meta-session') as MetaSessionRecord[];
        const session = sessions.find((item) => item.id === input.sessionId);
        if (!session) throw new Error('Kh\u00f4ng t\u00ecm th\u1ea5y cookie \u0111\u1ec3 s\u1eeda t\u00ean.');
        await put(workspaceOwner, 'meta-session', { ...session, label: input.label, updated: new Date().toISOString() }).run();
      }
      if (input.tokenId) {
        const tokens = await getMetaTokens(workspaceOwner);
        const token = tokens.find((item) => item.id === input.tokenId);
        if (!token) throw new Error('Kh\u00f4ng t\u00ecm th\u1ea5y token \u0111\u1ec3 s\u1eeda t\u00ean.');
        await put(workspaceOwner, 'meta-token', { ...token, label: input.label, updated: new Date().toISOString() }).run();
      }
      await audit(workspaceOwner, `S\u1eeda t\u00ean kho cookie/token: ${input.label}`).run();
      return Response.json({ ok: true, accounts: await loadAccounts(workspaceOwner), message: '\u0110\u00e3 s\u1eeda t\u00ean.' });
    }

    const sessionIds = [...new Set(input.sessionIds)];
    const tokenIds = [...new Set(input.tokenIds)];
    const deletes = [
      ...sessionIds.map((id) => deleteRecord(workspaceOwner, 'meta-session', id)),
      ...tokenIds.flatMap((id) => [
        deleteRecord(workspaceOwner, 'meta-token', id),
        deleteRecord(workspaceOwner, 'token-inventory', inventoryId(workspaceOwner, id)),
        deleteRecord(workspaceOwner, 'account-snapshot', snapshotId(workspaceOwner, id)),
      ]),
    ];
    for (let index = 0; index < deletes.length; index += 50) await db().batch(deletes.slice(index, index + 50));
    await audit(workspaceOwner, `X\u00f3a kho cookie/token: ${sessionIds.length} cookie, ${tokenIds.length} token`).run();
    return Response.json({
      ok: true,
      deletedSessions: sessionIds.length,
      deletedTokens: tokenIds.length,
      accounts: await loadAccounts(workspaceOwner),
      message: `\u0110\u00e3 x\u00f3a ${sessionIds.length} cookie v\u00e0 ${tokenIds.length} token.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'D\u1eef li\u1ec7u kho cookie/token kh\u00f4ng h\u1ee3p l\u1ec7.' }, { status: 400 });
    return Response.json({ error: redactSecrets((error as Error).message) }, { status: 400 });
  }
}
