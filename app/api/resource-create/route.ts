import { z } from 'zod';
import type { Asset } from '../../../lib/data';
import {
  discoverAccountSnapshot,
  toStoredAccountSnapshot,
  type StoredAccountSnapshot,
} from '../../../lib/account-snapshot';
import { canonicalOpenUrl } from '../../../lib/resource-model';
import { audit, db, list, owner, put } from '../../../lib/server';
import { getSessionCookieByUid, uidFromLabel } from '../../../lib/credential-vault';
import { getMetaTokenSecret, updateMetaToken } from '../../../lib/meta-tokens';

const requestSchema = z.object({
  action: z.literal('import_token'),
  tokenId: z.string().uuid(),
});

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

function assetId(workspaceOwner: string, metaId: string) {
  return `${workspaceOwner}:meta:${metaId}`;
}

function adAccountStatus(value: unknown) {
  const status = Number(value || 0);
  if (status === 1) return 'LIVE';
  if ([2, 101].includes(status)) return 'DIE';
  return 'Hạn chế';
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });

  try {
    const workspaceOwner = await owner();
    const input = requestSchema.parse(await req.json());
    const source = await getMetaTokenSecret(workspaceOwner, input.tokenId);
    const [storedSnapshots, existing] = await Promise.all([
      list(workspaceOwner, 'account-snapshot') as Promise<StoredAccountSnapshot[]>,
      list(workspaceOwner, 'asset') as Promise<Asset[]>,
    ]);
    const savedSnapshot = storedSnapshots.find((snapshot) => snapshot.tokenId === input.tokenId);
    let snapshot: StoredAccountSnapshot;

    if (savedSnapshot) {
      snapshot = savedSnapshot;
    } else {
      const uidHint = source.record.metaUserId || uidFromLabel(source.record.label);
      let cookie = '';
      try { cookie = await getSessionCookieByUid(workspaceOwner, uidHint); } catch { cookie = ''; }
      const discovered = await discoverAccountSnapshot({ token: source.token, cookie: cookie || undefined });
      snapshot = toStoredAccountSnapshot(workspaceOwner, input.tokenId, discovered);
      await put(workspaceOwner, 'account-snapshot', snapshot).run();
    }

    const now = new Date().toISOString();
    const existingById = new Map(existing.map((asset) => [asset.id, asset] as const));
    const imported = new Map<string, Asset>();
    const common = (current?: Asset) => ({
      source: 'meta',
      checked: snapshot.capturedAt || now,
      sourceTokenId: source.record.id,
      createdById: snapshot.actor.id || current?.createdById,
      createdByName: snapshot.actor.name || current?.createdByName,
      healthNote: `Đồng bộ từ Account Snapshot (${snapshot.source}).`,
    });

    for (const account of snapshot.adAccounts) {
      const id = assetId(workspaceOwner, account.id);
      const current = existingById.get(id);
      const currency = account.currency || current?.currency || '';
      const asset: Asset = {
        ...current,
        id,
        metaId: account.id,
        name: account.name || current?.name || `Ads ${account.id}`,
        type: 'TKQC',
        status: adAccountStatus(account.accountStatus),
        verified: false,
        country: current?.country || 'Chưa rõ',
        tier: current?.tier || '—',
        limit: account.spendCap && account.spendCap !== '0' ? `${account.spendCap} ${currency} (đơn vị API)` : current?.limit || 'Chưa thiết lập',
        parent: account.businessIds[0] ? assetId(workspaceOwner, account.businessIds[0]) : '',
        currency,
        metaStatus: Number(account.accountStatus || 0),
        assetSources: account.sources,
        ...common(current),
      };
      asset.openUrl = canonicalOpenUrl(asset);
      imported.set(id, asset);
    }

    for (const page of snapshot.pages) {
      const id = assetId(workspaceOwner, page.id);
      const current = existingById.get(id);
      const asset: Asset = {
        ...current,
        id,
        metaId: page.id,
        name: page.name || current?.name || `Page ${page.id}`,
        type: 'Page',
        status: 'Truy cập được',
        verified: false,
        country: current?.country || 'Chưa rõ',
        tier: current?.tier || '—',
        limit: current?.limit || '—',
        parent: page.businessIds[0] ? assetId(workspaceOwner, page.businessIds[0]) : '',
        assetSources: page.sources,
        ...common(current),
      };
      asset.openUrl = canonicalOpenUrl(asset);
      imported.set(id, asset);
    }

    for (const pixel of snapshot.pixels) {
      const id = assetId(workspaceOwner, pixel.id);
      const current = existingById.get(id);
      imported.set(id, {
        ...current,
        id,
        metaId: pixel.id,
        name: pixel.name || current?.name || `Pixel ${pixel.id}`,
        type: 'Dataset/Pixel',
        status: 'Truy cập được',
        verified: false,
        country: current?.country || 'Chưa rõ',
        tier: current?.tier || '—',
        limit: current?.limit || '—',
        parent: pixel.businessIds[0] ? assetId(workspaceOwner, pixel.businessIds[0]) : '',
        assetSources: pixel.sources,
        ...common(current),
      });
    }

    for (const business of snapshot.businesses) {
      const id = assetId(workspaceOwner, business.id);
      const current = existingById.get(id);
      const asset: Asset = {
        ...current,
        id,
        metaId: business.id,
        name: business.name || current?.name || `Business ${business.id}`,
        type: 'BM',
        status: 'Truy cập được',
        verified: business.verificationStatus?.toLowerCase() === 'verified',
        verificationStatus: business.verificationStatus || current?.verificationStatus || 'unknown',
        country: current?.country || 'Chưa rõ',
        tier: business.bmType,
        bmType: business.bmType,
        accountCapacity: business.accountCapacity,
        limit: business.accountCapacity === null ? 'unknown' : String(business.accountCapacity),
        parent: '',
        creationTime: business.createdTime || current?.creationTime,
        timezoneId: business.timezoneId || current?.timezoneId,
        primaryPageId: business.primaryPage?.id || current?.primaryPageId,
        primaryPageName: business.primaryPage?.name || current?.primaryPageName,
        adAccountCount: business.adAccountCount,
        pageCount: business.pageIds.length,
        currencies: business.currencies,
        currencyMode: business.currencyMode,
        currency: business.currency,
        assetSources: business.sources,
        accessLinkStatus: current?.accessLinkStatus || 'none',
        shopStatus: current?.shopStatus || 'not_ready',
        ...common(current),
      };
      asset.openUrl = canonicalOpenUrl(asset);
      imported.set(id, asset);
    }

    const assets = [...imported.values()];
    const statements = assets.map((asset) => put(workspaceOwner, 'asset', asset));
    for (let index = 0; index < statements.length; index += 50) await db().batch(statements.slice(index, index + 50));

    await updateMetaToken(workspaceOwner, source.record, {
      status: 'active',
      metaUserId: snapshot.actor.id || source.record.metaUserId,
      metaUserName: snapshot.actor.name || source.record.metaUserName,
      lastCheckedAt: snapshot.capturedAt,
      lastUsedAt: now,
      lastError: undefined,
      lastErrorCode: undefined,
      lastErrorSubcode: undefined,
    });
    await audit(workspaceOwner, `Đồng bộ ${assets.length} tài nguyên từ Account Snapshot của token ${source.record.label}`).run();

    const businesses = assets.filter((asset) => asset.type === 'BM').length;
    const adAccounts = assets.filter((asset) => asset.type === 'TKQC').length;
    const pages = assets.filter((asset) => asset.type === 'Page').length;
    const pixels = assets.filter((asset) => asset.type === 'Dataset/Pixel').length;
    return Response.json({
      ok: true,
      imported: assets.length,
      businesses,
      adAccounts,
      pages,
      pixels,
      confirmedPermissions: snapshot.confirmedPermissions,
      inferredPermissions: snapshot.inferredPermissions,
      warnings: snapshot.warnings,
      snapshotAt: snapshot.capturedAt,
      message: `Đã đồng bộ cùng Account Snapshot: ${businesses} BM, ${adAccounts} ADS, ${pages} Page${pixels ? `, ${pixels} Pixel/Dataset` : ''}.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'Token nguồn không hợp lệ.' }, { status: 400 });
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
