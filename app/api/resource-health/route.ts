import { z } from 'zod';
import { applyBmProfile, readBmProfile } from '../../../lib/bm-profile';
import {
  classifyAdDelivery,
  type AdAccessStatus,
  type AdDeliveryClassification,
} from '../../../lib/ad-status';
import { getSessionCookieByUid } from '../../../lib/credential-vault';
import type { Asset } from '../../../lib/data';
import { inspectAdAccountSession, type SessionAdAccount } from '../../../lib/meta-session';
import { audit, db, list, owner, put } from '../../../lib/server';
import { mapPool } from '../../../lib/resource-model';
import { redactSecrets } from '../../../lib/redact';
import { AD_ACCOUNT_FIELD_VARIANTS, readWithFieldFallback } from '../../../lib/graph-field-fallback';
import {
  classifyMetaTokenError,
  getMetaTokenSecret,
  getMetaTokens,
  graphWithToken,
  isGraphCompatibilityError,
  updateMetaToken,
  type MetaTokenRecord,
} from '../../../lib/meta-tokens';

const requestSchema = z.object({
  ids: z.array(z.string().min(1).max(240)).min(1).max(100),
  tokenId: z.string().uuid().optional().or(z.literal('')),
});

type MetaObject = Record<string, unknown>;
type HealthState = 'LIVE' | 'DIE' | 'RESTRICTED' | 'UNKNOWN' | 'SKIPPED';

type ItemResult = {
  id: string;
  metaId: string;
  name: string;
  type: string;
  health: HealthState;
  tokenLabel?: string;
  message: string;
};

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

async function graphWithFieldFallback(token: string, path: string, variants: string[]) {
  return readWithFieldFallback(variants,
    (fields) => graphWithToken(token, path, { fields }),
    (error) => {
      const classified = classifyMetaTokenError(error);
      return [100, 200].includes(classified.code ?? -1) || isGraphCompatibilityError(error);
    });
}

function optionalBoolean(value: unknown) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return undefined;
}

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function metaIdOf(asset: Asset) {
  if (asset.metaId) return String(asset.metaId);
  const marker = asset.id.lastIndexOf(':meta:');
  if (marker >= 0) return asset.id.slice(marker + 6);
  if (asset.id.startsWith('meta:')) return asset.id.slice(5);
  return '';
}

function graphPath(asset: Asset, metaId: string) {
  if (asset.type === 'TKQC' && /^\d+$/.test(metaId)) return `act_${metaId}`;
  return metaId;
}

/**
 * Health state cho UI từ delivery classification. Code chưa map / missing
 * => UNKNOWN (giữ raw), KHÔNG suy đoán thành RESTRICTED hay DIE.
 */
function accountHealth(statusValue: unknown): {
  health: HealthState;
  appStatus: string;
  note: string;
  delivery: AdDeliveryClassification;
} {
  const delivery = classifyAdDelivery(statusValue);
  const raw = delivery.rawAccountStatus;
  switch (delivery.deliveryStatus) {
    case 'LIVE':
      return { health: 'LIVE', appStatus: 'LIVE', note: 'Tài khoản quảng cáo đang ACTIVE theo Meta.', delivery };
    case 'DISABLED':
      return { health: 'DIE', appStatus: 'DIE', note: `Meta account_status=${raw}.`, delivery };
    case 'UNSETTLED':
      return { health: 'DIE', appStatus: 'Chưa thanh toán', note: `Meta account_status=${raw} (UNSETTLED).`, delivery };
    case 'CLOSED':
      return { health: 'DIE', appStatus: 'Đã đóng', note: `Meta account_status=${raw} (CLOSED).`, delivery };
    case 'PENDING':
      return { health: 'RESTRICTED', appStatus: 'Chờ xử lý', note: `Meta account_status=${raw} (PENDING).`, delivery };
    case 'RESTRICTED':
      return { health: 'RESTRICTED', appStatus: 'Hạn chế', note: `Meta account_status=${raw}; cần kiểm tra trong Ads Manager.`, delivery };
    default:
      return {
        health: 'UNKNOWN',
        appStatus: 'Chưa xác định',
        note: `Meta trả account_status=${raw === undefined ? 'trống' : raw} chưa map. Giữ nguyên raw, không suy đoán thành DIE/hạn chế.`,
        delivery,
      };
  }
}

function applySessionAdAccount(asset: Asset, account: SessionAdAccount, now: string, graphError: string) {
  const delivery = classifyAdDelivery(account.accountStatus);
  const statusKnown = delivery.deliveryStatus !== 'UNKNOWN' && delivery.rawAccountStatus !== undefined;
  const state = statusKnown ? accountHealth(delivery.rawAccountStatus) : null;
  const currency = account.currency || asset.currency || '';
  const spendCap = account.spendCap || asset.spendCap;
  // Session mở đúng TKQC này => ACCESSIBLE. Không có account_status => delivery UNKNOWN,
  // KHÔNG "Chưa đọc được" một mình và không bị coi là mất quyền.
  const message = state
    ? `${state.note} Chi tiết được đọc qua session.`
    : `Session xác nhận truy cập được TKQC này; trạng thái quảng cáo chưa xác định. Graph: ${redactSecrets(graphError)}`;
  const next: Asset = {
    ...asset,
    name: account.name || asset.name,
    status: state?.appStatus || 'Truy cập được',
    metaStatus: delivery.rawAccountStatus,
    accountStatus: delivery.rawAccountStatus,
    rawAccountStatus: delivery.rawAccountStatus ?? asset.rawAccountStatus,
    accessStatus: 'ACCESSIBLE' as AdAccessStatus,
    deliveryStatus: state?.delivery.deliveryStatus || delivery.deliveryStatus,
    readSource: 'SESSION',
    disableReason: account.disableReason ?? asset.disableReason,
    currency,
    amountSpent: account.amountSpent || asset.amountSpent,
    balance: account.balance || asset.balance,
    spendCap,
    minDailyBudget: account.minDailyBudget || asset.minDailyBudget,
    billingType: account.isPrepayAccount === true
      ? 'PREPAID'
      : account.isPrepayAccount === false
        ? 'POSTPAID'
        : asset.billingType || 'UNKNOWN',
    hasFundingSource: account.fundingSource ? true : asset.hasFundingSource,
    fundingDisplay: account.fundingSource || asset.fundingDisplay,
    timezoneId: account.timezoneId || asset.timezoneId,
    timezoneName: account.timezoneName || asset.timezoneName,
    ownerId: account.ownerId || asset.ownerId,
    ownership: account.ownership || asset.ownership || 'unknown',
    businessName: account.businessName || asset.businessName,
    country: account.country || asset.country,
    creationTime: account.createdTime || asset.creationTime,
    limit: spendCap && spendCap !== '0' ? `${spendCap} ${currency} (đơn vị API)` : asset.limit,
    checked: now,
    statusCheckedAt: now,
    healthNote: message,
  };
  return { next, health: state?.health || 'UNKNOWN' as HealthState, message };
}

function sourceUserId(asset: Asset, byId: Map<string, Asset>) {
  const direct = text(asset.createdById);
  if (direct) return direct;
  if (asset.parent) return text(byId.get(asset.parent)?.createdById);
  return '';
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
  }

  try {
    const workspaceOwner = await owner();
    const input = requestSchema.parse(await req.json());
    const [allAssets, tokenRecords] = await Promise.all([
      list(workspaceOwner, 'asset') as Promise<Asset[]>,
      getMetaTokens(workspaceOwner),
    ]);
    const byId = new Map(allAssets.map((asset) => [asset.id, asset] as const));
    const chosen = input.ids.map((id) => byId.get(id)).filter((asset): asset is Asset => Boolean(asset));
    if (!chosen.length) throw new Error('Không tìm thấy tài nguyên đã chọn.');

    const tokenByMetaUser = new Map(
      tokenRecords
        .filter((token) => token.metaUserId)
        .map((token) => [String(token.metaUserId), token] as const),
    );
    const tokenCache = new Map<string, { record: MetaTokenRecord; token: string }>();
    const haltedTokens = new Map<string, string>();
    const sessionCookieCache = new Map<string, Promise<string>>();

    function sessionCookie(uid: string) {
      if (!uid) return Promise.resolve('');
      const cached = sessionCookieCache.get(uid);
      if (cached) return cached;
      const pending = getSessionCookieByUid(workspaceOwner, uid).catch(() => '');
      sessionCookieCache.set(uid, pending);
      return pending;
    }

    async function resolveToken(asset: Asset) {
      let record: MetaTokenRecord | undefined;
      if (input.tokenId) {
        record = tokenRecords.find((token) => token.id === input.tokenId);
      } else {
        const metaUserId = sourceUserId(asset, byId);
        record = metaUserId ? tokenByMetaUser.get(metaUserId) : undefined;
      }
      if (!record) return null;
      const halted = haltedTokens.get(record.id);
      if (halted) return { record, token: '', halted };
      const cached = tokenCache.get(record.id);
      if (cached) return cached;
      const secret = await getMetaTokenSecret(workspaceOwner, record.id);
      const value = { record: secret.record, token: secret.token };
      tokenCache.set(record.id, value);
      return value;
    }

    const results: ItemResult[] = [];
    const updates: Asset[] = [];
    const events: Array<Record<string, unknown>> = [];

    // Ghi token là read-modify-write; chặn clobber khi nhiều asset cùng token chạy song song.
    const tokenLocks = new Map<string, Promise<void>>();
    function withTokenLock<T>(tokenId: string, task: () => Promise<T>): Promise<T> {
      const previous = tokenLocks.get(tokenId) || Promise.resolve();
      const run = previous.then(task, task);
      tokenLocks.set(tokenId, run.then(() => undefined, () => undefined));
      return run;
    }

    // Graph GET dạng node chỉ trả đúng khi fields hợp lệ; Business dùng created_time.
    // Check theo nhóm 4 tài nguyên một lúc để lượt 100 tài nguyên không vượt timeout.
    await mapPool(chosen, 4, async (asset) => {
      const now = new Date().toISOString();
      const metaId = metaIdOf(asset);
      if (!metaId) {
        const message = 'Tài nguyên chưa có Meta ID nên chưa thể kiểm tra.';
        results.push({ id: asset.id, metaId: '', name: asset.name, type: asset.type, health: 'SKIPPED', message });
        updates.push({ ...asset, checked: now, healthNote: message });
        events.push({ id: crypto.randomUUID(), assetId: asset.id, metaId: '', type: asset.type, health: 'SKIPPED', error: message, checked: now });
        return;
      }

      const resolved = await resolveToken(asset);
      if (!resolved) {
        const message = input.tokenId
          ? 'Không tìm thấy token đã chọn.'
          : 'Chưa xác định được token nguồn. Chọn một token thủ công để kiểm tra tài nguyên này.';
        results.push({ id: asset.id, metaId, name: asset.name, type: asset.type, health: 'SKIPPED', message });
        updates.push({ ...asset, checked: now, healthNote: message });
        events.push({ id: crypto.randomUUID(), assetId: asset.id, metaId, type: asset.type, health: 'SKIPPED', error: message, checked: now });
        return;
      }

      if ('halted' in resolved) {
        const message = `Bỏ qua vì token ${resolved.record.label} đã dừng trong lượt kiểm tra này: ${resolved.halted}`;
        results.push({ id: asset.id, metaId, name: asset.name, type: asset.type, health: 'SKIPPED', tokenLabel: resolved.record.label, message });
        updates.push({ ...asset, checked: now, healthNote: message });
        events.push({ id: crypto.randomUUID(), assetId: asset.id, metaId, type: asset.type, health: 'SKIPPED', tokenId: resolved.record.id, tokenLabel: resolved.record.label, error: message, checked: now });
        return;
      }

      try {
        const path = graphPath(asset, metaId);
        const fieldVariants = asset.type === 'BM'
          ? ['id,name,verification_status,created_time,updated_time,timezone_id,primary_page,vertical,two_factor_type', 'id,name,verification_status,created_time,timezone_id,primary_page']
          : asset.type === 'TKQC'
            ? AD_ACCOUNT_FIELD_VARIANTS
            : asset.type === 'Page'
              ? ['id,name,category,verification_status,followers_count,fan_count,link', 'id,name,category,verification_status,link', 'id,name']
              : ['id,name,creation_time,last_fired_time', 'id,name'];
        const meta = await graphWithFieldFallback(resolved.token, path, fieldVariants);
        let next: Asset;
        let health: HealthState = 'LIVE';
        let message = 'Meta trả về tài nguyên và token vẫn có quyền truy cập.';

        if (asset.type === 'TKQC') {
          const state = accountHealth(meta.account_status);
          const accountStatus = state.delivery.rawAccountStatus;
          health = state.health;
          message = state.delivery.deliveryStatus === 'UNKNOWN'
            ? 'Meta trả tài khoản nhưng account_status chưa xác định; TKQC vẫn ACCESSIBLE qua Graph.'
            : state.note;
          const currency = text(meta.currency) || asset.currency || '';
          const spendCap = text(meta.spend_cap);
          const funding = objectValue(meta.funding_source_details);
          const business = objectValue(meta.business);
          const accountOwner = objectValue(meta.owner);
          const directOwnerId = typeof meta.owner === 'string' || typeof meta.owner === 'number' ? text(meta.owner) : '';
          const ownerId = directOwnerId || text(accountOwner.id) || asset.ownerId;
          const parentAsset = asset.parent ? byId.get(asset.parent) : undefined;
          const parentBusinessId = parentAsset ? metaIdOf(parentAsset) : '';
          const prepay = optionalBoolean(meta.is_prepay_account);
          next = {
            ...asset,
            name: text(meta.name) || asset.name,
            status: state.appStatus,
            metaStatus: accountStatus,
            accountStatus,
            rawAccountStatus: accountStatus,
            accessStatus: 'ACCESSIBLE' as AdAccessStatus,
            deliveryStatus: state.delivery.deliveryStatus,
            readSource: 'GRAPH',
            disableReason: optionalNumber(meta.disable_reason) ?? asset.disableReason,
            currency,
            spendCap: spendCap || asset.spendCap,
            amountSpent: text(meta.amount_spent) || asset.amountSpent,
            balance: text(meta.balance) || asset.balance,
            minDailyBudget: text(meta.min_daily_budget) || asset.minDailyBudget,
            billingType: prepay === true ? 'PREPAID' : prepay === false ? 'POSTPAID' : asset.billingType || 'UNKNOWN',
            hasFundingSource: Object.hasOwn(meta, 'funding_source') || Object.hasOwn(meta, 'funding_source_details')
              ? Boolean(text(meta.funding_source) || text(funding.id) || text(funding.display_string))
              : asset.hasFundingSource,
            fundingType: text(funding.type) || asset.fundingType,
            fundingDisplay: text(funding.display_string) || asset.fundingDisplay,
            timezoneId: text(meta.timezone_id) || asset.timezoneId,
            timezoneName: text(meta.timezone_name) || asset.timezoneName,
            timezoneOffsetHoursUtc: optionalNumber(meta.timezone_offset_hours_utc) ?? asset.timezoneOffsetHoursUtc,
            ownerId,
            ownership: ownerId && parentBusinessId
              ? ownerId === parentBusinessId ? 'owned' : 'client'
              : asset.ownership || 'unknown',
            businessName: text(business.name) || asset.businessName,
            creationTime: text(meta.created_time) || asset.creationTime,
            limit: spendCap && spendCap !== '0' ? `${spendCap} ${currency} (đơn vị API)` : asset.limit,
            checked: now,
            statusCheckedAt: now,
            healthNote: message,
          };
        } else if (asset.type === 'BM') {
          next = applyBmProfile({
            ...asset,
            name: text(meta.name) || asset.name,
            status: 'Truy cập được',
            verificationStatus: text(meta.verification_status) || asset.verificationStatus || 'unknown',
            verified: text(meta.verification_status).toLowerCase() === 'verified',
            creationTime: text(meta.created_time) || asset.creationTime,
            updatedTime: text(meta.updated_time) || asset.updatedTime,
            timezoneId: text(meta.timezone_id) || asset.timezoneId,
            vertical: text(meta.vertical) || asset.vertical,
            twoFactorType: text(meta.two_factor_type) || asset.twoFactorType,
            primaryPageId: text(objectValue(meta.primary_page).id) || asset.primaryPageId,
            primaryPageName: text(objectValue(meta.primary_page).name) || asset.primaryPageName,
            checked: now,
            healthNote: message,
          }, {});
          try { next = applyBmProfile(next, await readBmProfile(resolved.token, metaId)); } catch { /* keep counts already stored */ }
          next = { ...next, checked: now, statusCheckedAt: now, healthNote: message, status: 'Truy cập được' };
        } else {
          next = {
            ...asset,
            name: text(meta.name) || asset.name,
            ...(asset.type === 'Page' ? {
              category: text(meta.category) || asset.category,
              verificationStatus: text(meta.verification_status) || asset.verificationStatus,
              verified: text(meta.verification_status) ? text(meta.verification_status).toLowerCase() === 'verified' : asset.verified,
              followersCount: Number(meta.followers_count || 0) || asset.followersCount,
              fanCount: Number(meta.fan_count || 0) || asset.fanCount,
              pageLink: text(meta.link) || asset.pageLink,
            } : {
              creationTime: text(meta.creation_time) || asset.creationTime,
              lastFiredTime: text(meta.last_fired_time) || asset.lastFiredTime,
            }),
            status: 'Truy cập được',
            checked: now,
            statusCheckedAt: now,
            healthNote: message,
          };
        }

        updates.push(next);
        results.push({ id: asset.id, metaId, name: next.name, type: asset.type, health, tokenLabel: resolved.record.label, message });
        events.push({ id: crypto.randomUUID(), assetId: asset.id, metaId, type: asset.type, health, tokenId: resolved.record.id, tokenLabel: resolved.record.label, checked: now, metaStatus: next.metaStatus });
        // Ghi token là read-modify-write: bên trong lock phải lấy record MỚI NHẤT
        // từ cache (asset cùng token chạy song song có thể vừa ghi) rồi mới merge patch,
        // tránh clobber lastError/status của worker khác.
        await withTokenLock(resolved.record.id, async () => {
          const latest = tokenCache.get(resolved.record.id)?.record || resolved.record;
          const updatedRecord = await updateMetaToken(workspaceOwner, latest, {
            status: 'active',
            lastCheckedAt: now,
            lastError: undefined,
            lastErrorCode: undefined,
            lastErrorSubcode: undefined,
          });
          tokenCache.set(updatedRecord.id, { record: updatedRecord, token: resolved.token });
        });
      } catch (error) {
        const classified = classifyMetaTokenError(error);
        if (asset.type === 'TKQC') {
          const sessionUid = text(resolved.record.metaUserId) || sourceUserId(asset, byId);
          const cookie = await sessionCookie(sessionUid);
          if (cookie) {
            const parentAsset = asset.parent ? byId.get(asset.parent) : undefined;
            const parentBusinessId = parentAsset ? metaIdOf(parentAsset) : '';
            const sessionAccount = await inspectAdAccountSession(cookie, metaId, parentBusinessId).catch(() => null);
            if (sessionAccount) {
              const fallback = applySessionAdAccount(asset, sessionAccount, now, classified.reason);
              updates.push(fallback.next);
              results.push({
                id: asset.id,
                metaId,
                name: fallback.next.name,
                type: asset.type,
                health: fallback.health,
                tokenLabel: resolved.record.label,
                message: fallback.message,
              });
              events.push({
                id: crypto.randomUUID(),
                assetId: asset.id,
                metaId,
                type: asset.type,
                health: fallback.health,
                tokenId: resolved.record.id,
                tokenLabel: resolved.record.label,
                checked: now,
                source: 'session',
                metaStatus: fallback.next.metaStatus,
              });
              return;
            }
          }
        }
        const appStatus = classified.status === 'permission_issue' ? 'Cần kiểm tra quyền' : 'Không xác định';
        const health: HealthState = classified.status === 'permission_issue' ? 'RESTRICTED' : 'UNKNOWN';
        // Lỗi đọc một tài nguyên KHÔNG đủ bằng chứng kết luận mất quyền vĩnh viễn:
        // accessStatus = UNKNOWN, giữ nguyên deliveryStatus cũ (last known), không đụng token DIE.
        const message = redactSecrets(classified.reason);
        updates.push({
          ...asset,
          status: appStatus,
          accessStatus: 'UNKNOWN' as AdAccessStatus,
          checked: now,
          statusCheckedAt: now,
          healthNote: message,
        });
        results.push({ id: asset.id, metaId, name: asset.name, type: asset.type, health, tokenLabel: resolved.record.label, message });
        events.push({ id: crypto.randomUUID(), assetId: asset.id, metaId, type: asset.type, health, tokenId: resolved.record.id, tokenLabel: resolved.record.label, error: message, errorCode: classified.code, errorSubcode: classified.subcode, checked: now });

        await withTokenLock(resolved.record.id, async () => {
          const latest = tokenCache.get(resolved.record.id)?.record || resolved.record;
          const updatedRecord = await updateMetaToken(workspaceOwner, latest, {
            status: classified.status,
            lastCheckedAt: now,
            lastError: message,
            lastErrorCode: classified.code,
            lastErrorSubcode: classified.subcode,
          });
          tokenCache.set(updatedRecord.id, { record: updatedRecord, token: resolved.token });
          if (classified.status === 'invalid' || classified.status === 'rate_limited') {
            haltedTokens.set(updatedRecord.id, message);
          }
        });
      }
    });

    await db().batch([
      ...updates.map((asset) => put(workspaceOwner, 'asset', asset)),
      ...events.map((event) => put(workspaceOwner, 'health-event', event)),
      audit(
        workspaceOwner,
        `Health Check ${results.length} tài nguyên · LIVE ${results.filter((item) => item.health === 'LIVE').length} · DIE ${results.filter((item) => item.health === 'DIE').length} · hạn chế ${results.filter((item) => item.health === 'RESTRICTED').length}`,
      ),
    ]);

    return Response.json({
      ok: true,
      results,
      summary: {
        total: results.length,
        live: results.filter((item) => item.health === 'LIVE').length,
        die: results.filter((item) => item.health === 'DIE').length,
        restricted: results.filter((item) => item.health === 'RESTRICTED').length,
        unknown: results.filter((item) => item.health === 'UNKNOWN').length,
        skipped: results.filter((item) => item.health === 'SKIPPED').length,
      },
      message: `Đã kiểm tra ${results.length} tài nguyên bằng Meta Graph API. Không tự đổi token hoặc retry khi token lỗi/rate limit.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Chọn từ 1 đến 100 tài nguyên hợp lệ.' }, { status: 400 });
    }
    return Response.json({ error: redactSecrets((error as Error).message) }, { status: 400 });
  }
}
