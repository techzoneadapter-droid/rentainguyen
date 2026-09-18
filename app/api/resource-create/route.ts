import { z } from 'zod';
import type { Asset } from '../../../lib/data';
import {
  classifyAdDelivery,
  readSourceFromSources,
} from '../../../lib/ad-status';
import {
  discoverAccountSnapshot,
  toStoredAccountSnapshot,
} from '../../../lib/account-snapshot';
import { canonicalOpenUrl } from '../../../lib/resource-model';
import { audit, db, list, owner, put } from '../../../lib/server';
import { getSessionCookieByUid, uidFromLabel } from '../../../lib/credential-vault';
import { getMetaTokenSecret, updateMetaToken } from '../../../lib/meta-tokens';
import { redactSecrets } from '../../../lib/redact';

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

/**
 * Chuỗi hiển thị gọn cho asset.status; model đầy đủ nằm ở
 * accessStatus/deliveryStatus/readSource/rawAccountStatus trên asset.
 * TKQC thấy trong snapshot = ACCESSIBLE, kể cả khi account_status chưa đọc được
 * (session tìm thấy nhưng không có status → "Truy cập được", KHÔNG "Chưa đọc được").
 */
const DELIVERY_DISPLAY: Record<string, string> = {
  LIVE: 'LIVE',
  DISABLED: 'DIE',
  RESTRICTED: 'Hạn chế',
  PENDING: 'Chờ xử lý',
  UNSETTLED: 'Chưa thanh toán',
  CLOSED: 'Đã đóng',
};
function adAccountStatusLabel(value: unknown, accessible: boolean) {
  const { deliveryStatus } = classifyAdDelivery(value);
  if (deliveryStatus === 'UNKNOWN') return accessible ? 'Truy cập được' : 'Chưa đọc được';
  if (deliveryStatus === 'LIVE') return DELIVERY_DISPLAY.LIVE;
  return DELIVERY_DISPLAY[deliveryStatus] || 'Chưa xác định';
}

function isGenericBusinessName(name: string, businessId: string) {
  return !name || new RegExp(`^(?:BM|Business)\\s+${businessId}$`, 'i').test(name.trim());
}

function knownVerification(value?: string) {
  const normalized = String(value || '').trim();
  return normalized && normalized.toLowerCase() !== 'unknown' ? normalized : undefined;
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });

  try {
    const workspaceOwner = await owner();
    const input = requestSchema.parse(await req.json());
    const source = await getMetaTokenSecret(workspaceOwner, input.tokenId);
    const existing = await list(workspaceOwner, 'asset') as Asset[];
    const uidHint = source.record.metaUserId || uidFromLabel(source.record.label);
    let cookie = '';
    try { cookie = await getSessionCookieByUid(workspaceOwner, uidHint); } catch { cookie = ''; }
    const discovered = await discoverAccountSnapshot({ token: source.token, cookie: cookie || undefined });
    const snapshot = toStoredAccountSnapshot(workspaceOwner, input.tokenId, discovered);
    await put(workspaceOwner, 'account-snapshot', snapshot).run();

    const now = new Date().toISOString();
    const existingById = new Map(existing.map((asset) => [asset.id, asset] as const));
    const imported = new Map<string, Asset>();
    const common = (current?: Asset) => ({
      source: 'meta',
      checked: snapshot.capturedAt || now,
      // Freshness riêng cho resource scan, không trộn với auth/status check.
      resourceScannedAt: snapshot.capturedAt || now,
      sourceTokenId: source.record.id,
      createdById: snapshot.actor.id || current?.createdById,
      createdByName: snapshot.actor.name || current?.createdByName,
      healthNote: `Đồng bộ từ Account Snapshot (${snapshot.source}).`,
    });

    for (const account of snapshot.adAccounts) {
      const id = assetId(workspaceOwner, account.id);
      const current = existingById.get(id);
      const currency = account.currency || current?.currency || '';
      const accountStatus = account.accountStatus;
      const delivery = classifyAdDelivery(accountStatus);
      const asset: Asset = {
        ...current,
        id,
        metaId: account.id,
        name: account.name || current?.name || `Ads ${account.id}`,
        type: 'TKQC',
        status: adAccountStatusLabel(accountStatus, true),
        verified: false,
        country: account.country || 'Chưa đọc được',
        tier: current?.tier || '—',
        limit: account.spendCap && account.spendCap !== '0' ? `${account.spendCap} ${currency} (đơn vị API)` : current?.limit || 'Chưa thiết lập',
        parent: account.businessIds[0] ? assetId(workspaceOwner, account.businessIds[0]) : '',
        currency,
        metaStatus: accountStatus,
        accountStatus,
        rawAccountStatus: delivery.rawAccountStatus ?? current?.rawAccountStatus,
        accessStatus: 'ACCESSIBLE',
        deliveryStatus: delivery.deliveryStatus,
        readSource: readSourceFromSources(account.sources) === 'UNKNOWN' ? current?.readSource : readSourceFromSources(account.sources),
        disableReason: account.disableReason ?? current?.disableReason,
        amountSpent: account.amountSpent || current?.amountSpent,
        balance: account.balance || current?.balance,
        spendCap: account.spendCap || current?.spendCap,
        minDailyBudget: account.minDailyBudget || current?.minDailyBudget,
        billingType: account.isPrepayAccount === true ? 'PREPAID' : account.isPrepayAccount === false ? 'POSTPAID' : current?.billingType || 'UNKNOWN',
        hasFundingSource: account.fundingSource || account.fundingType || account.fundingDisplay ? true : current?.hasFundingSource,
        fundingType: account.fundingType || current?.fundingType,
        fundingDisplay: account.fundingDisplay || current?.fundingDisplay,
        timezoneId: account.timezoneId || current?.timezoneId,
        timezoneName: account.timezoneName || current?.timezoneName,
        timezoneOffsetHoursUtc: account.timezoneOffsetHoursUtc ?? current?.timezoneOffsetHoursUtc,
        ownerId: account.ownerId || current?.ownerId,
        ownership: account.ownership || current?.ownership || 'unknown',
        businessName: account.businessName || current?.businessName,
        creationTime: account.createdTime || current?.creationTime,
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
        country: current?.country || 'Chưa rõ',
        tier: current?.tier || '—',
        limit: current?.limit || '—',
        parent: page.businessIds[0] ? assetId(workspaceOwner, page.businessIds[0]) : '',
        category: page.category || current?.category,
        verificationStatus: page.verificationStatus || current?.verificationStatus,
        verified: page.verificationStatus ? page.verificationStatus.toLowerCase() === 'verified' : Boolean(current?.verified),
        followersCount: page.followersCount ?? current?.followersCount,
        fanCount: page.fanCount ?? current?.fanCount,
        pageLink: page.link || current?.pageLink,
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
        creationTime: pixel.creationTime || current?.creationTime,
        lastFiredTime: pixel.lastFiredTime || current?.lastFiredTime,
        assetSources: pixel.sources,
        ...common(current),
      });
    }

    for (const business of snapshot.businesses) {
      const id = assetId(workspaceOwner, business.id);
      const current = existingById.get(id);
      const name = isGenericBusinessName(business.name, business.id) && current?.name && !isGenericBusinessName(current.name, business.id)
        ? current.name
        : business.name || current?.name || `Business ${business.id}`;
      const verificationStatus = knownVerification(business.verificationStatus)
        || knownVerification(current?.verificationStatus);
      const asset: Asset = {
        ...current,
        id,
        metaId: business.id,
        name,
        type: 'BM',
        status: 'Truy cập được',
        verified: verificationStatus?.toLowerCase() === 'verified',
        verificationStatus,
        country: business.country || 'Chưa đọc được',
        tier: business.bmType,
        bmType: business.bmType,
        accountCapacity: business.accountCapacity,
        limit: business.accountCapacity === null ? 'unknown' : String(business.accountCapacity),
        parent: '',
        creationTime: business.createdTime || current?.creationTime,
        updatedTime: business.updatedTime || current?.updatedTime,
        vertical: business.vertical || current?.vertical,
        twoFactorType: business.twoFactorType || current?.twoFactorType,
        timezoneId: business.timezoneId || current?.timezoneId,
        primaryPageId: business.primaryPage?.id || current?.primaryPageId,
        primaryPageName: business.primaryPage?.name || current?.primaryPageName,
        adAccountCount: business.adAccountCount,
        ownedAdAccountCount: business.ownedAdAccountCount,
        pageCount: business.pageCount,
        observedAdAccountCount: business.observedAdAccountCount,
        observedOwnedAdAccountCount: business.observedOwnedAdAccountCount,
        observedPageCount: business.observedPageCount,
        bmDetailsStatus: business.detailsStatus,
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
    // BM tạo tại chỗ (creationStatus=created) phải được giữ ngay cả khi Meta chưa kịp
    // trả nó trong /me/businesses hoặc lần scan này chỉ đọc được qua cookie session.
    // Session HTML có thể trả thiếu khi một trang Facebook lỗi mạng. Chỉ xóa stale khi
    // Graph là nguồn duy nhất và đã trả snapshot có thẩm quyền.
    const authoritativeSync = snapshot.source === 'graph' && snapshot.warnings.length === 0;
    const stale = authoritativeSync
      ? existing.filter((asset) => (
          asset.sourceTokenId === source.record.id && !imported.has(asset.id) && asset.creationStatus !== 'created'
        ))
      : [];
    const statements = [
      ...stale.map((asset) => db().prepare('DELETE FROM records WHERE owner = ? AND kind = ? AND id = ?').bind(workspaceOwner, 'asset', asset.id)),
      ...assets.map((asset) => put(workspaceOwner, 'asset', asset)),
    ];
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
    return Response.json({ error: redactSecrets((error as Error).message) }, { status: 400 });
  }
}
