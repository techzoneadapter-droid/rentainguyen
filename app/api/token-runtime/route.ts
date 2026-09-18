import { z } from 'zod';
import type { Asset } from '../../../lib/data';
import { summarizeAdBuckets } from '../../../lib/ad-status';
import { discoverAccountSnapshot, toStoredAccountSnapshot } from '../../../lib/account-snapshot';
import { audit, db, list, owner, put } from '../../../lib/server';
import { getSessionCookieByUid, uidFromLabel } from '../../../lib/credential-vault';
import {
  classifyMetaTokenError,
  cleanMetaToken,
  encryptToken,
  getMetaTokenSecret,
  getMetaTokens,
  MetaTokenError,
  publicToken,
  tokenFingerprint,
  type MetaTokenRecord,
  type MetaTokenStatus,
} from '../../../lib/meta-tokens';
import { redactSecrets } from '../../../lib/redact';

type AdCounts = {
  liveAdCount: number | null;
  dieAdCount: number | null;
  restrictedAdCount: number | null;
  pendingAdCount: number | null;
  unsettledAdCount: number | null;
  closedAdCount: number | null;
  unknownAdCount: number | null;
};

type TokenInventory = {
  id: string;
  tokenId: string;
  status: MetaTokenStatus;
  metaUserId?: string;
  metaUserName?: string;
  permissions: string[];
  confirmedPermissions: string[];
  inferredPermissions: string[];
  // null = lần scan đó KHÔNG đọc được (scan fail / không đủ quyền), khác hẳn 0 thật.
  businessCount: number | null;
  verifiedBusinessCount: number | null;
  pageCount: number | null;
  adAccountCount: number | null;
  pixelCount: number | null;
  totalResources: number | null;
  warnings: string[];
  lastError?: string;
  scannedAt: string;
  created: string;
} & AdCounts;

const importSchema = z.object({
  action: z.literal('import'),
  items: z.array(z.object({
    label: z.string().trim().max(80).optional(),
    uid: z.string().trim().regex(/^\d{5,30}$/).optional(),
    token: z.string().trim().min(20).max(4096),
  })).min(1).max(20),
});

const scanSchema = z.object({
  action: z.literal('scan'),
  ids: z.array(z.string().uuid()).min(1).max(20),
});

const renameSchema = z.object({
  action: z.literal('rename'),
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(80),
});

const deleteSchema = z.object({
  action: z.literal('delete'),
  ids: z.array(z.string().uuid()).min(1).max(100),
  purgeAssets: z.boolean().default(true),
});

const requestSchema = z.discriminatedUnion('action', [importSchema, scanSchema, renameSchema, deleteSchema]);

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

function inventoryId(workspaceOwner: string, tokenId: string) {
  return `${workspaceOwner}:token-inventory:${tokenId}`;
}

function snapshotId(workspaceOwner: string, tokenId: string) {
  return `${workspaceOwner}:account-snapshot:${tokenId}`;
}

function deleteRecord(workspaceOwner: string, kind: string, id: string) {
  return db().prepare('DELETE FROM records WHERE owner = ? AND kind = ? AND id = ?').bind(workspaceOwner, kind, id);
}

/**
 * adBucket chuyển sang lib/ad-status.ts: undefined/null/'' → 'unknown',
 * KHÔNG mặc định thành 'restricted' như bản dùng Number(statusValue || 0) cũ.
 */

/**
 * Scan fail ≠ không có tài nguyên: mọi count là null để UI hiển thị "Chưa đọc được"
 * thay vì fake 0. unknownAdCount giữ bucket riêng để total luôn bằng tổng bucket.
 */
function emptyInventory(workspaceOwner: string, record: MetaTokenRecord, now: string, status: MetaTokenStatus, lastError: string): TokenInventory {
  return {
    id: inventoryId(workspaceOwner, record.id),
    tokenId: record.id,
    status,
    permissions: [],
    confirmedPermissions: [],
    inferredPermissions: [],
    businessCount: null,
    verifiedBusinessCount: null,
    pageCount: null,
    adAccountCount: null,
    liveAdCount: null,
    dieAdCount: null,
    restrictedAdCount: null,
    pendingAdCount: null,
    unsettledAdCount: null,
    closedAdCount: null,
    unknownAdCount: null,
    pixelCount: null,
    totalResources: null,
    warnings: [],
    lastError,
    scannedAt: now,
    created: now,
  };
}

async function scanToken(workspaceOwner: string, record: MetaTokenRecord, rawToken: string) {
  const now = new Date().toISOString();
  const token = cleanMetaToken(rawToken);
  if (!token || token.length < 20) {
    throw new MetaTokenError('Token trống hoặc quá ngắn sau khi làm sạch.', { code: 400, httpStatus: 400 });
  }

  const warnings: string[] = [];
  const uidHint = record.metaUserId || uidFromLabel(record.label);
  let cookie = '';
  try {
    cookie = await getSessionCookieByUid(workspaceOwner, uidHint);
  } catch (error) {
    warnings.push(`Cookie vault: ${(error as Error).message}`);
  }

  try {
    const snapshot = await discoverAccountSnapshot({ token, cookie: cookie || undefined });
    warnings.push(...snapshot.warnings);
    if (snapshot.source !== 'graph') warnings.push(`Nguồn check: ${snapshot.source}.`);
    const workingToken = snapshot.workingCredential.token || token;
    const buckets = summarizeAdBuckets(snapshot.adAccounts.map((account) => account.accountStatus));
    const inventory: TokenInventory = {
      id: inventoryId(workspaceOwner, record.id),
      tokenId: record.id,
      status: 'active',
      metaUserId: snapshot.actor.id,
      metaUserName: snapshot.actor.name,
      permissions: snapshot.confirmedPermissions,
      confirmedPermissions: snapshot.confirmedPermissions,
      inferredPermissions: snapshot.inferredPermissions,
      businessCount: snapshot.businesses.length,
      verifiedBusinessCount: snapshot.businesses.filter((business) => business.verificationStatus?.toLowerCase() === 'verified').length,
      pageCount: snapshot.pages.length,
      adAccountCount: snapshot.adAccounts.length,
      liveAdCount: buckets.live,
      dieAdCount: buckets.die,
      restrictedAdCount: buckets.restricted,
      pendingAdCount: buckets.pending,
      unsettledAdCount: buckets.unsettled,
      closedAdCount: buckets.closed,
      unknownAdCount: buckets.unknown,
      pixelCount: snapshot.pixels.length,
      totalResources: snapshot.businesses.length + snapshot.adAccounts.length + snapshot.pages.length + snapshot.pixels.length,
      warnings: [...new Set(warnings)].slice(0, 40),
      scannedAt: snapshot.capturedAt,
      created: now,
    };

    await db().batch([
      put(workspaceOwner, 'token-inventory', inventory),
      put(workspaceOwner, 'account-snapshot', toStoredAccountSnapshot(workspaceOwner, record.id, snapshot)),
      put(workspaceOwner, 'meta-token', {
        ...record,
        encrypted: await encryptToken(workingToken),
        fingerprint: await tokenFingerprint(workingToken),
        status: 'active',
        metaUserId: snapshot.actor.id || record.metaUserId,
        metaUserName: snapshot.actor.name || record.metaUserName,
        lastCheckedAt: snapshot.capturedAt,
        lastError: undefined,
        lastErrorCode: undefined,
        lastErrorSubcode: undefined,
        updated: now,
      }),
    ]);
    return inventory;
  } catch (error) {
    const classified = classifyMetaTokenError(error);
    const inventory = emptyInventory(workspaceOwner, record, now, classified.status, classified.reason);
    await db().batch([
      put(workspaceOwner, 'token-inventory', inventory),
      put(workspaceOwner, 'meta-token', {
        ...record,
        encrypted: await encryptToken(token),
        fingerprint: await tokenFingerprint(token),
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
    return Response.json({ error: redactSecrets((error as Error).message) }, { status: 400 });
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
  try {
    const workspaceOwner = await owner();
    const input = requestSchema.parse(await req.json());
    const inventories: TokenInventory[] = [];

    if (input.action === 'rename') {
      const records = await getMetaTokens(workspaceOwner);
      const record = records.find((item) => item.id === input.id);
      if (!record) throw new Error('Không tìm thấy token để sửa tên.');
      await put(workspaceOwner, 'meta-token', { ...record, label: input.label, updated: new Date().toISOString() }).run();
      await audit(workspaceOwner, `Sửa tên token: ${record.label} → ${input.label}`).run();
      return Response.json({ ok: true, tokens: await joinedRows(workspaceOwner), message: 'Đã sửa tên token.' });
    }

    if (input.action === 'delete') {
      const ids = new Set(input.ids);
      const deletes = input.ids.flatMap((id) => [
        deleteRecord(workspaceOwner, 'meta-token', id),
        deleteRecord(workspaceOwner, 'token-inventory', inventoryId(workspaceOwner, id)),
        deleteRecord(workspaceOwner, 'account-snapshot', snapshotId(workspaceOwner, id)),
      ]);
      let purgedAssets = 0;
      if (input.purgeAssets) {
        const assets = await list(workspaceOwner, 'asset') as Asset[];
        const linked = assets.filter((asset) => ids.has(String(asset.sourceTokenId || '')));
        purgedAssets = linked.length;
        deletes.push(...linked.map((asset) => deleteRecord(workspaceOwner, 'asset', asset.id)));
      }
      for (let index = 0; index < deletes.length; index += 50) await db().batch(deletes.slice(index, index + 50));
      await audit(workspaceOwner, `Xóa ${input.ids.length} token${purgedAssets ? ` và ${purgedAssets} tài nguyên liên quan` : ''}`).run();
      return Response.json({ ok: true, deleted: input.ids.length, purgedAssets, tokens: await joinedRows(workspaceOwner), message: `Đã xóa ${input.ids.length} token.` });
    }

    if (input.action === 'import') {
      const existing = await getMetaTokens(workspaceOwner);
      const byFingerprint = new Map(existing.map((record) => [record.fingerprint, record] as const));
      let imported = 0;
      let reused = 0;
      for (const item of input.items) {
        const token = cleanMetaToken(item.token);
        const fingerprint = await tokenFingerprint(token);
        let record = byFingerprint.get(fingerprint);
        const now = new Date().toISOString();
        if (!record) {
          record = {
            id: crypto.randomUUID(),
            label: item.label || (item.uid ? `UID ${item.uid}` : `Token ${existing.length + imported + 1}`),
            encrypted: await encryptToken(token),
            fingerprint,
            status: 'unknown_error',
            metaUserId: item.uid,
            created: now,
            updated: now,
          };
          imported += 1;
        } else {
          record = {
            ...record,
            label: item.label || record.label,
            encrypted: await encryptToken(token),
            metaUserId: item.uid || record.metaUserId,
            lastError: undefined,
            lastErrorCode: undefined,
            lastErrorSubcode: undefined,
            updated: now,
          };
          reused += 1;
        }
        await put(workspaceOwner, 'meta-token', record).run();
        byFingerprint.set(fingerprint, record);
        inventories.push(await scanToken(workspaceOwner, record, token));
      }
      await audit(workspaceOwner, `Nạp và check token: mới ${imported}, dùng lại ${reused}`).run();
      return Response.json({ imported, reused, processed: input.items.length, inventories, tokens: await joinedRows(workspaceOwner), message: `Đã nạp và check ${input.items.length} token.` });
    }

    for (const id of input.ids) {
      try {
        const source = await getMetaTokenSecret(workspaceOwner, id);
        inventories.push(await scanToken(workspaceOwner, source.record, source.token));
      } catch (error) {
        const record = (await getMetaTokens(workspaceOwner)).find((item) => item.id === id);
        if (!record) continue;
        const now = new Date().toISOString();
        const reason = `Không giải mã được token đã lưu. Hãy nạp lại token này. ${(error as Error).message}`;
        const inventory = emptyInventory(workspaceOwner, record, now, 'unknown_error', reason);
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
    if (error instanceof z.ZodError) return Response.json({ error: 'Dữ liệu token không hợp lệ. Mỗi lượt tối đa 20 token khi nạp/check; xóa tối đa 100 token.' }, { status: 400 });
    return Response.json({ error: redactSecrets((error as Error).message) }, { status: 400 });
  }
}
