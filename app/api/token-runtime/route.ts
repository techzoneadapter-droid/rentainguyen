import { z } from 'zod';
import { audit, db, list, owner, put } from '../../../lib/server';
import {
  classifyMetaTokenError,
  encryptToken,
  getMetaTokenSecret,
  getMetaTokens,
  graphWithToken,
  publicToken,
  tokenFingerprint,
  type MetaTokenRecord,
  type MetaTokenStatus,
} from '../../../lib/meta-tokens';

type MetaObject = Record<string, unknown>;
type GraphListResponse = MetaObject & {
  data?: unknown[];
  paging?: { cursors?: { after?: string } };
};

type TokenInventory = {
  id: string;
  tokenId: string;
  status: MetaTokenStatus;
  metaUserId?: string;
  metaUserName?: string;
  permissions: string[];
  businessCount: number;
  verifiedBusinessCount: number;
  pageCount: number;
  adAccountCount: number;
  liveAdCount: number;
  dieAdCount: number;
  restrictedAdCount: number;
  pixelCount: number;
  totalResources: number;
  warnings: string[];
  lastError?: string;
  scannedAt: string;
  created: string;
};

const importSchema = z.object({
  action: z.literal('import'),
  items: z.array(z.object({
    label: z.string().trim().max(80).optional(),
    token: z.string().trim().min(20).max(4096),
  })).min(1).max(20),
});

const scanSchema = z.object({
  action: z.literal('scan'),
  ids: z.array(z.string().uuid()).min(1).max(20),
});

const requestSchema = z.union([importSchema, scanSchema]);

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

function text(value: unknown) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function objectValue(value: unknown): MetaObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as MetaObject : {};
}

function inventoryId(workspaceOwner: string, tokenId: string) {
  return `${workspaceOwner}:token-inventory:${tokenId}`;
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeMe(token: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await graphWithToken(token, 'me', { fields: 'id,name' }) as MetaObject;
    } catch (error) {
      lastError = error;
      const classified = classifyMetaTokenError(error);
      if (classified.status !== 'unknown_error' && classified.status !== 'rate_limited') throw error;
      if (attempt === 0) await wait(350);
    }
  }
  throw lastError;
}

async function graphListWithToken(token: string, path: string, fields: string) {
  const rows: MetaObject[] = [];
  let after = '';
  for (let page = 0; page < 12; page += 1) {
    const response = await graphWithToken(token, path, {
      fields,
      limit: '100',
      ...(after ? { after } : {}),
    }) as GraphListResponse;
    const pageRows = Array.isArray(response.data) ? response.data.map(objectValue) : [];
    rows.push(...pageRows);
    const next = text(response.paging?.cursors?.after);
    if (!next || pageRows.length === 0) break;
    after = next;
  }
  return rows;
}

async function safeList(token: string, path: string, fields: string, warnings: string[]) {
  try {
    return await graphListWithToken(token, path, fields);
  } catch (error) {
    const classified = classifyMetaTokenError(error);
    warnings.push(`${path}: ${classified.reason}`);
    return [];
  }
}

async function readPermissions(token: string, warnings: string[]) {
  try {
    const rows = await graphListWithToken(token, 'me/permissions', 'permission,status');
    return rows
      .filter((row) => text(row.status).toLowerCase() === 'granted')
      .map((row) => text(row.permission))
      .filter(Boolean)
      .sort();
  } catch (error) {
    const classified = classifyMetaTokenError(error);
    warnings.push(`permissions: ${classified.reason}`);
    return [];
  }
}

function adBucket(statusValue: unknown) {
  const status = Number(statusValue || 0);
  if (status === 1) return 'live' as const;
  if ([2, 101].includes(status)) return 'die' as const;
  return 'restricted' as const;
}

function uniqueIds(rows: MetaObject[], normalize = (value: string) => value) {
  return new Map(
    rows
      .map((row) => [normalize(text(row.id)), row] as const)
      .filter(([id]) => /^\d{5,30}$/.test(id)),
  );
}

async function scanToken(workspaceOwner: string, record: MetaTokenRecord, token: string) {
  const now = new Date().toISOString();
  const warnings: string[] = [];
  try {
    const me = await probeMe(token);
    const [permissions, businesses, directPages, directAds] = await Promise.all([
      readPermissions(token, warnings),
      safeList(token, 'me/businesses', 'id,name,verification_status', warnings),
      safeList(token, 'me/accounts', 'id,name,tasks', warnings),
      safeList(token, 'me/adaccounts', 'id,name,account_status,disable_reason', warnings),
    ]);

    const pageMap = uniqueIds(directPages);
    const adMap = uniqueIds(directAds, (id) => id.replace(/^act_/, ''));
    const pixelMap = new Map<string, MetaObject>();

    for (const business of businesses) {
      const businessId = text(business.id);
      if (!/^\d{5,30}$/.test(businessId)) continue;
      const [ownedAds, clientAds, ownedPages, clientPages, pixels] = await Promise.all([
        safeList(token, `${businessId}/owned_ad_accounts`, 'id,name,account_status,disable_reason', warnings),
        safeList(token, `${businessId}/client_ad_accounts`, 'id,name,account_status,disable_reason', warnings),
        safeList(token, `${businessId}/owned_pages`, 'id,name', warnings),
        safeList(token, `${businessId}/client_pages`, 'id,name', warnings),
        safeList(token, `${businessId}/adspixels`, 'id,name', warnings),
      ]);
      for (const [id, row] of uniqueIds([...ownedAds, ...clientAds], (value) => value.replace(/^act_/, ''))) adMap.set(id, row);
      for (const [id, row] of uniqueIds([...ownedPages, ...clientPages])) pageMap.set(id, row);
      for (const [id, row] of uniqueIds(pixels)) pixelMap.set(id, row);
    }

    const ads = [...adMap.values()];
    const liveAdCount = ads.filter((account) => adBucket(account.account_status) === 'live').length;
    const dieAdCount = ads.filter((account) => adBucket(account.account_status) === 'die').length;
    const restrictedAdCount = Math.max(0, ads.length - liveAdCount - dieAdCount);
    const inventory: TokenInventory = {
      id: inventoryId(workspaceOwner, record.id),
      tokenId: record.id,
      status: 'active',
      metaUserId: text(me.id),
      metaUserName: text(me.name),
      permissions,
      businessCount: businesses.length,
      verifiedBusinessCount: businesses.filter((business) => text(business.verification_status).toLowerCase() === 'verified').length,
      pageCount: pageMap.size,
      adAccountCount: adMap.size,
      liveAdCount,
      dieAdCount,
      restrictedAdCount,
      pixelCount: pixelMap.size,
      totalResources: businesses.length + pageMap.size + adMap.size + pixelMap.size,
      warnings: warnings.slice(0, 20),
      scannedAt: now,
      created: now,
    };

    await db().batch([
      put(workspaceOwner, 'token-inventory', inventory),
      put(workspaceOwner, 'meta-token', {
        ...record,
        status: 'active',
        metaUserId: inventory.metaUserId || record.metaUserId,
        metaUserName: inventory.metaUserName || record.metaUserName,
        lastCheckedAt: now,
        lastError: warnings.length ? warnings.slice(0, 3).join(' | ') : undefined,
        lastErrorCode: undefined,
        lastErrorSubcode: undefined,
        updated: now,
      }),
    ]);
    return inventory;
  } catch (error) {
    const classified = classifyMetaTokenError(error);
    const inventory: TokenInventory = {
      id: inventoryId(workspaceOwner, record.id),
      tokenId: record.id,
      status: classified.status,
      permissions: [],
      businessCount: 0,
      verifiedBusinessCount: 0,
      pageCount: 0,
      adAccountCount: 0,
      liveAdCount: 0,
      dieAdCount: 0,
      restrictedAdCount: 0,
      pixelCount: 0,
      totalResources: 0,
      warnings: [],
      lastError: classified.reason,
      scannedAt: now,
      created: now,
    };
    await db().batch([
      put(workspaceOwner, 'token-inventory', inventory),
      put(workspaceOwner, 'meta-token', {
        ...record,
        status: classified.status,
        lastCheckedAt: now,
        lastError: classified.reason,
        lastErrorCode: classified.code,
        lastErrorSubcode: classified.subcode,
        updated: now,
      }),
    ]);
    return inventory;
  }
}

async function joinedRows(workspaceOwner: string) {
  const [tokens, inventories] = await Promise.all([
    getMetaTokens(workspaceOwner),
    list(workspaceOwner, 'token-inventory') as Promise<TokenInventory[]>,
  ]);
  const byToken = new Map(inventories.map((item) => [item.tokenId, item] as const));
  return tokens.map((token) => ({ ...publicToken(token), inventory: byToken.get(token.id) || null }));
}

export async function GET() {
  try {
    const workspaceOwner = await owner();
    return Response.json({ tokens: await joinedRows(workspaceOwner) });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
  try {
    const workspaceOwner = await owner();
    const input = requestSchema.parse(await req.json());
    const inventories: TokenInventory[] = [];

    if (input.action === 'import') {
      const existing = await getMetaTokens(workspaceOwner);
      const byFingerprint = new Map(existing.map((record) => [record.fingerprint, record] as const));
      let imported = 0;
      let reused = 0;

      for (const item of input.items) {
        const fingerprint = await tokenFingerprint(item.token);
        let record = byFingerprint.get(fingerprint);
        if (!record) {
          const now = new Date().toISOString();
          record = {
            id: crypto.randomUUID(),
            label: item.label || `Token ${existing.length + imported + 1}`,
            encrypted: await encryptToken(item.token),
            fingerprint,
            status: 'unknown_error',
            created: now,
            updated: now,
          };
          imported += 1;
        } else {
          record = {
            ...record,
            label: item.label || record.label,
            encrypted: await encryptToken(item.token),
            lastError: undefined,
            lastErrorCode: undefined,
            lastErrorSubcode: undefined,
            updated: new Date().toISOString(),
          };
          reused += 1;
        }
        await put(workspaceOwner, 'meta-token', record).run();
        byFingerprint.set(fingerprint, record);
        inventories.push(await scanToken(workspaceOwner, record, item.token));
      }

      await audit(workspaceOwner, `Nạp/check token: mới ${imported}, dùng lại ${reused}`).run();
      return Response.json({ imported, reused, processed: input.items.length, inventories, tokens: await joinedRows(workspaceOwner) });
    }

    for (const id of input.ids) {
      try {
        const source = await getMetaTokenSecret(workspaceOwner, id);
        inventories.push(await scanToken(workspaceOwner, source.record, source.token));
      } catch (error) {
        const records = await getMetaTokens(workspaceOwner);
        const record = records.find((item) => item.id === id);
        if (!record) continue;
        const now = new Date().toISOString();
        const reason = `Không giải mã được token đã lưu. Hãy nạp lại chính token này để app mã hóa lại bằng TOKEN_ENCRYPTION_KEY hiện tại. ${(error as Error).message}`;
        const inventory: TokenInventory = {
          id: inventoryId(workspaceOwner, record.id), tokenId: record.id, status: 'unknown_error', permissions: [],
          businessCount: 0, verifiedBusinessCount: 0, pageCount: 0, adAccountCount: 0, liveAdCount: 0,
          dieAdCount: 0, restrictedAdCount: 0, pixelCount: 0, totalResources: 0, warnings: [], lastError: reason,
          scannedAt: now, created: now,
        };
        await db().batch([
          put(workspaceOwner, 'token-inventory', inventory),
          put(workspaceOwner, 'meta-token', { ...record, status: 'unknown_error', lastCheckedAt: now, lastError: reason, updated: now }),
        ]);
        inventories.push(inventory);
      }
    }
    await audit(workspaceOwner, `Check lại ${input.ids.length} token`).run();
    return Response.json({ processed: input.ids.length, inventories, tokens: await joinedRows(workspaceOwner) });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'Dữ liệu token không hợp lệ. Mỗi lượt tối đa 20 token.' }, { status: 400 });
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
