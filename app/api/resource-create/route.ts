import { z } from 'zod';
import type { Asset } from '../../../lib/data';
import { audit, db, list, owner, put } from '../../../lib/server';
import {
  classifyMetaTokenError,
  getMetaTokenSecret,
  graphListWithToken,
  inspectUserToken,
  updateMetaToken,
} from '../../../lib/meta-tokens';

const requestSchema = z.object({
  action: z.literal('import_token'),
  tokenId: z.string().uuid(),
});

type MetaObject = Record<string, unknown>;

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

async function safeList(token: string, path: string, fields: string, warnings: string[]) {
  try {
    return await graphListWithToken(token, path, fields, 20);
  } catch (error) {
    const classified = classifyMetaTokenError(error);
    warnings.push(`${path}: ${classified.reason}`);
    return [];
  }
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
  if (!sameOrigin(req)) {
    return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
  }

  try {
    const workspaceOwner = await owner();
    const input = requestSchema.parse(await req.json());
    const source = await getMetaTokenSecret(workspaceOwner, input.tokenId);
    const now = new Date().toISOString();
    const warnings: string[] = [];

    let inspection;
    try {
      inspection = await inspectUserToken(source.token);
      warnings.push(...inspection.warnings);
    } catch (error) {
      const classified = classifyMetaTokenError(error);
      await updateMetaToken(workspaceOwner, source.record, {
        status: classified.status,
        lastCheckedAt: now,
        lastUsedAt: now,
        lastError: classified.reason,
        lastErrorCode: classified.code,
        lastErrorSubcode: classified.subcode,
      });
      return Response.json({ error: classified.reason }, { status: 400 });
    }

    const [businesses, directAccounts] = await Promise.all([
      safeList(source.token, 'me/businesses', 'id,name,verification_status,timezone_id,primary_page,created_time', warnings),
      safeList(source.token, 'me/adaccounts', 'id,name,account_status,spend_cap,currency,disable_reason', warnings),
    ]);

    const metaUserId = inspection.me.id;
    const metaUserName = inspection.me.name;
    const existing = await list(workspaceOwner, 'asset') as Asset[];
    const existingById = new Map(existing.map((asset) => [asset.id, asset] as const));
    const importedById = new Map<string, Asset>();

    function saveAsset(asset: Asset) {
      const previous = importedById.get(asset.id);
      if (previous && previous.parent && !asset.parent) return;
      importedById.set(asset.id, asset);
    }

    function common(current: Asset | undefined) {
      return {
        source: 'meta',
        checked: now,
        sourceTokenId: source.record.id,
        createdById: metaUserId || current?.createdById,
        createdByName: metaUserName || current?.createdByName,
        healthNote: `Đồng bộ từ token ${source.record.label} (GET /me + edges).`,
      };
    }

    function addAccount(account: MetaObject, parent = '') {
      const accountId = text(account.id).replace(/^act_/, '');
      if (!/^\d{5,30}$/.test(accountId)) return;
      const recordId = assetId(workspaceOwner, accountId);
      const current = existingById.get(recordId);
      const currency = text(account.currency) || current?.currency || '';
      const spendCap = text(account.spend_cap);
      saveAsset({
        ...current,
        id: recordId,
        metaId: accountId,
        name: text(account.name) || current?.name || `Ads ${accountId}`,
        type: 'TKQC',
        status: adAccountStatus(account.account_status),
        verified: false,
        country: current?.country || 'Chưa rõ',
        tier: current?.tier || '—',
        limit: spendCap && spendCap !== '0' ? `${spendCap} ${currency} (đơn vị API)` : current?.limit || 'Chưa thiết lập',
        parent,
        currency,
        metaStatus: Number(account.account_status || 0),
        ...common(current),
      });
    }

    function addSimple(item: MetaObject, type: 'Page' | 'Dataset/Pixel', parent = '') {
      const metaId = text(item.id);
      if (!/^\d{5,30}$/.test(metaId)) return;
      const recordId = assetId(workspaceOwner, metaId);
      const current = existingById.get(recordId);
      saveAsset({
        ...current,
        id: recordId,
        metaId,
        name: text(item.name) || current?.name || `${type} ${metaId}`,
        type,
        status: 'Truy cập được',
        verified: false,
        country: current?.country || 'Chưa rõ',
        tier: current?.tier || '—',
        limit: current?.limit || '—',
        parent,
        ...common(current),
      });
    }

    directAccounts.forEach((account) => addAccount(account));
    inspection.pages.forEach((page) => addSimple(page as unknown as MetaObject, 'Page'));

    for (const business of businesses) {
      const businessId = text(business.id);
      if (!/^\d{5,30}$/.test(businessId)) continue;
      const primaryPage = objectValue(business.primary_page);
      const businessRecordId = assetId(workspaceOwner, businessId);
      const currentBusiness = existingById.get(businessRecordId);
      const verificationStatus = text(business.verification_status) || 'unknown';

      saveAsset({
        ...currentBusiness,
        id: businessRecordId,
        metaId: businessId,
        name: text(business.name) || currentBusiness?.name || `Business ${businessId}`,
        type: 'BM',
        status: 'Truy cập được',
        verified: verificationStatus.toLowerCase() === 'verified',
        verificationStatus,
        country: currentBusiness?.country || 'Chưa rõ',
        tier: currentBusiness?.tier || 'Chưa rõ',
        limit: currentBusiness?.limit || 'Chưa rõ',
        parent: '',
        creationTime: text(business.created_time) || currentBusiness?.creationTime,
        timezoneId: text(business.timezone_id) || currentBusiness?.timezoneId,
        primaryPageId: text(primaryPage.id) || currentBusiness?.primaryPageId,
        primaryPageName: text(primaryPage.name) || currentBusiness?.primaryPageName,
        ...common(currentBusiness),
      });

      const [ownedAccounts, clientAccounts, ownedPages, clientPages, pixels] = await Promise.all([
        safeList(source.token, `${businessId}/owned_ad_accounts`, 'id,name,account_status,spend_cap,currency,disable_reason', warnings),
        safeList(source.token, `${businessId}/client_ad_accounts`, 'id,name,account_status,spend_cap,currency,disable_reason', warnings),
        safeList(source.token, `${businessId}/owned_pages`, 'id,name', warnings),
        safeList(source.token, `${businessId}/client_pages`, 'id,name', warnings),
        safeList(source.token, `${businessId}/adspixels`, 'id,name', warnings),
      ]);

      [...ownedAccounts, ...clientAccounts].forEach((account) => addAccount(account, businessRecordId));
      [...ownedPages, ...clientPages].forEach((page) => addSimple(page, 'Page', businessRecordId));
      pixels.forEach((pixel) => addSimple(pixel, 'Dataset/Pixel', businessRecordId));
    }

    const unique = Array.from(importedById.values());
    const statements = unique.map((asset) => put(workspaceOwner, 'asset', asset));
    for (let index = 0; index < statements.length; index += 50) {
      await db().batch(statements.slice(index, index + 50));
    }

    await updateMetaToken(workspaceOwner, source.record, {
      status: 'active',
      metaUserId: metaUserId || source.record.metaUserId,
      metaUserName: metaUserName || source.record.metaUserName,
      lastCheckedAt: now,
      lastUsedAt: now,
      lastError: warnings.length ? warnings.slice(0, 4).join(' | ') : undefined,
      lastErrorCode: undefined,
      lastErrorSubcode: undefined,
    });
    await audit(workspaceOwner, `Đồng bộ ${unique.length} tài nguyên từ token ${source.record.label}`).run();

    const businessesCount = unique.filter((asset) => asset.type === 'BM').length;
    const adAccountsCount = unique.filter((asset) => asset.type === 'TKQC').length;
    const pagesCount = unique.filter((asset) => asset.type === 'Page').length;
    const pixelsCount = unique.filter((asset) => asset.type === 'Dataset/Pixel').length;

    return Response.json({
      ok: true,
      imported: unique.length,
      businesses: businessesCount,
      adAccounts: adAccountsCount,
      pages: pagesCount,
      pixels: pixelsCount,
      warnings: warnings.slice(0, 12),
      message: `Đã đồng bộ ${unique.length} tài nguyên từ ${source.record.label}: ${businessesCount} BM, ${adAccountsCount} ADS, ${pagesCount} Page${pixelsCount ? `, ${pixelsCount} Pixel/Dataset` : ''}.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Token nguồn không hợp lệ.' }, { status: 400 });
    }
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
