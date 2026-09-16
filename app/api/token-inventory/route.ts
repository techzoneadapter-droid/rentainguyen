import { z } from 'zod';
import { audit, db, list, owner, put } from '../../../lib/server';
import {
  classifyMetaTokenError,
  encryptToken,
  getMetaTokenSecret,
  getMetaTokens,
  graphListWithToken,
  inspectUserToken,
  publicToken,
  tokenFingerprint,
  type MetaTokenRecord,
  type MetaTokenStatus,
} from '../../../lib/meta-tokens';

type MetaObject = Record<string, unknown>;

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

function inventoryId(workspaceOwner: string, tokenId: string) {
  return `${workspaceOwner}:token-inventory:${tokenId}`;
}

async function graphListWithTokenLocal(token: string, path: string, fields: string) {
  return graphListWithToken(token, path, fields, 10);
}

async function safeList(token: string, path: string, fields: string, warnings: string[]) {
  try {
    return await graphListWithTokenLocal(token, path, fields);
  } catch (error) {
    const classified = classifyMetaTokenError(error);
    warnings.push(`${path}: ${classified.reason}`);
    return [];
  }
}

async function readPermissions(token: string, warnings: string[]) {
  try {
    const rows = await graphListWithTokenLocal(token, 'me/permissions', 'permission,status');
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

async function scanToken(workspaceOwner: string, record: MetaTokenRecord, token: string) {
  const now = new Date().toISOString();
  const warnings: string[] = [];
  try {
    const inspection = await inspectUserToken(token);
    warnings.push(...inspection.warnings);
    const [businesses, adAccounts] = await Promise.all([
      safeList(token, 'me/businesses', 'id,name,verification_status', warnings),
      safeList(token, 'me/adaccounts', 'id,name,account_status,disable_reason', warnings),
    ]);
    const pages = inspection.pages;
    const permissions = inspection.permissions.length
      ? inspection.permissions
      : await readPermissions(token, warnings);

    const liveAdCount = adAccounts.filter((account) => adBucket(account.account_status) === 'live').length;
    const dieAdCount = adAccounts.filter((account) => adBucket(account.account_status) === 'die').length;
    const restrictedAdCount = Math.max(0, adAccounts.length - liveAdCount - dieAdCount);
    const inventory: TokenInventory = {
      id: inventoryId(workspaceOwner, record.id),
      tokenId: record.id,
      status: 'active',
      metaUserId: inspection.me.id,
      metaUserName: inspection.me.name,
      permissions,
      businessCount: businesses.length,
      verifiedBusinessCount: businesses.filter((business) => text(business.verification_status).toLowerCase() === 'verified').length,
      pageCount: pages.length,
      adAccountCount: adAccounts.length,
      liveAdCount,
      dieAdCount,
      restrictedAdCount,
      totalResources: businesses.length + pages.length + adAccounts.length,
      warnings: warnings.slice(0, 12),
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
        lastError: undefined,
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
  return tokens.map((token) => ({
    ...publicToken(token),
    inventory: byToken.get(token.id) || null,
  }));
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
  if (!sameOrigin(req)) {
    return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
  }

  try {
    const workspaceOwner = await owner();
    const input = requestSchema.parse(await req.json());
    const inventories: TokenInventory[] = [];

    if (input.action === 'import') {
      const existing = await getMetaTokens(workspaceOwner);
      const byFingerprint = new Map(existing.map((record) => [record.fingerprint, record] as const));
      let imported = 0;
      let reused = 0;

      for (let index = 0; index < input.items.length; index += 1) {
        const item = input.items[index];
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
          await put(workspaceOwner, 'meta-token', record).run();
          byFingerprint.set(fingerprint, record);
          imported += 1;
        } else {
          reused += 1;
        }
        const now = new Date().toISOString();
        const inventory: TokenInventory = {
          id: inventoryId(workspaceOwner, record.id),
          tokenId: record.id,
          status: record.status,
          permissions: [],
          businessCount: 0,
          verifiedBusinessCount: 0,
          pageCount: 0,
          adAccountCount: 0,
          liveAdCount: 0,
          dieAdCount: 0,
          restrictedAdCount: 0,
          totalResources: 0,
          warnings: ['Đã lưu local. Chưa gọi Meta Graph API.'],
          scannedAt: now,
          created: now,
        };
        await put(workspaceOwner, 'token-inventory', inventory).run();
        inventories.push(inventory);
      }

      await audit(workspaceOwner, `Nhập token local: mới ${imported}, đã có ${reused} • không gọi Graph`).run();
      return Response.json({
        imported,
        reused,
        processed: input.items.length,
        inventories,
        tokens: await joinedRows(workspaceOwner),
        message: `Đã lưu ${input.items.length} token trong workspace. Không gọi Graph API.`,
      });
    }

    for (const id of input.ids) {
      const source = await getMetaTokenSecret(workspaceOwner, id);
      inventories.push(await scanToken(workspaceOwner, source.record, source.token));
    }
    await audit(workspaceOwner, `Quét lại ${input.ids.length} token`).run();
    return Response.json({
      processed: input.ids.length,
      inventories,
      tokens: await joinedRows(workspaceOwner),
      message: `Đã quét lại ${input.ids.length} token.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Dữ liệu token hàng loạt không hợp lệ. Mỗi lượt tối đa 20 token.' }, { status: 400 });
    }
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
