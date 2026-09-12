import { z } from 'zod';
import type { Asset } from '../../../lib/data';
import { audit, db, list, owner, put } from '../../../lib/server';
import {
  classifyMetaTokenError,
  getMetaTokenSecret,
  getMetaTokens,
  graphWithToken,
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

function accountHealth(status: number): { health: HealthState; appStatus: string; note: string } {
  if (status === 1) return { health: 'LIVE', appStatus: 'LIVE', note: 'Tài khoản quảng cáo đang ACTIVE theo Meta.' };
  if ([2, 101].includes(status)) return { health: 'DIE', appStatus: 'DIE', note: `Meta account_status=${status}.` };
  return { health: 'RESTRICTED', appStatus: 'Hạn chế', note: `Meta account_status=${status || 'unknown'}; cần kiểm tra trong Ads Manager.` };
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

    for (const asset of chosen) {
      const now = new Date().toISOString();
      const metaId = metaIdOf(asset);
      if (!metaId) {
        const message = 'Tài nguyên chưa có Meta ID nên chưa thể kiểm tra.';
        results.push({ id: asset.id, metaId: '', name: asset.name, type: asset.type, health: 'SKIPPED', message });
        updates.push({ ...asset, checked: now, healthNote: message });
        events.push({ id: crypto.randomUUID(), assetId: asset.id, metaId: '', type: asset.type, health: 'SKIPPED', error: message, checked: now });
        continue;
      }

      const resolved = await resolveToken(asset);
      if (!resolved) {
        const message = input.tokenId
          ? 'Không tìm thấy token đã chọn.'
          : 'Chưa xác định được token nguồn. Chọn một token thủ công để kiểm tra tài nguyên này.';
        results.push({ id: asset.id, metaId, name: asset.name, type: asset.type, health: 'SKIPPED', message });
        updates.push({ ...asset, checked: now, healthNote: message });
        events.push({ id: crypto.randomUUID(), assetId: asset.id, metaId, type: asset.type, health: 'SKIPPED', error: message, checked: now });
        continue;
      }

      if ('halted' in resolved) {
        const message = `Bỏ qua vì token ${resolved.record.label} đã dừng trong lượt kiểm tra này: ${resolved.halted}`;
        results.push({ id: asset.id, metaId, name: asset.name, type: asset.type, health: 'SKIPPED', tokenLabel: resolved.record.label, message });
        updates.push({ ...asset, checked: now, healthNote: message });
        events.push({ id: crypto.randomUUID(), assetId: asset.id, metaId, type: asset.type, health: 'SKIPPED', tokenId: resolved.record.id, tokenLabel: resolved.record.label, error: message, checked: now });
        continue;
      }

      try {
        const path = graphPath(asset, metaId);
        const fields = asset.type === 'BM'
          ? 'id,name,verification_status,creation_time,timezone_id,primary_page'
          : asset.type === 'TKQC'
            ? 'id,name,account_status,currency,spend_cap,amount_spent,balance'
            : 'id,name';
        const meta = await graphWithToken(resolved.token, path, { fields });
        let next: Asset;
        let health: HealthState = 'LIVE';
        let message = 'Meta trả về tài nguyên và token vẫn có quyền truy cập.';

        if (asset.type === 'TKQC') {
          const accountStatus = Number(meta.account_status || 0);
          const state = accountHealth(accountStatus);
          health = state.health;
          message = state.note;
          const currency = text(meta.currency) || asset.currency || '';
          const spendCap = text(meta.spend_cap);
          next = {
            ...asset,
            name: text(meta.name) || asset.name,
            status: state.appStatus,
            metaStatus: accountStatus,
            currency,
            limit: spendCap && spendCap !== '0' ? `${spendCap} ${currency} (đơn vị API)` : asset.limit,
            checked: now,
            healthNote: message,
          };
        } else if (asset.type === 'BM') {
          const verificationStatus = text(meta.verification_status) || asset.verificationStatus || 'unknown';
          const primaryPage = objectValue(meta.primary_page);
          next = {
            ...asset,
            name: text(meta.name) || asset.name,
            status: 'Truy cập được',
            verified: verificationStatus.toLowerCase() === 'verified',
            verificationStatus,
            creationTime: text(meta.creation_time) || asset.creationTime,
            timezoneId: text(meta.timezone_id) || asset.timezoneId,
            primaryPageId: text(primaryPage.id) || asset.primaryPageId,
            primaryPageName: text(primaryPage.name) || asset.primaryPageName,
            checked: now,
            healthNote: message,
          };
        } else {
          next = {
            ...asset,
            name: text(meta.name) || asset.name,
            status: 'Truy cập được',
            checked: now,
            healthNote: message,
          };
        }

        updates.push(next);
        results.push({ id: asset.id, metaId, name: next.name, type: asset.type, health, tokenLabel: resolved.record.label, message });
        events.push({ id: crypto.randomUUID(), assetId: asset.id, metaId, type: asset.type, health, tokenId: resolved.record.id, tokenLabel: resolved.record.label, checked: now, metaStatus: next.metaStatus });
        const updatedRecord = await updateMetaToken(workspaceOwner, resolved.record, {
          status: 'active',
          lastCheckedAt: now,
          lastError: undefined,
          lastErrorCode: undefined,
          lastErrorSubcode: undefined,
        });
        tokenCache.set(updatedRecord.id, { record: updatedRecord, token: resolved.token });
      } catch (error) {
        const classified = classifyMetaTokenError(error);
        const appStatus = classified.status === 'permission_issue' ? 'Cần kiểm tra quyền' : 'Không xác định';
        const health: HealthState = classified.status === 'permission_issue' ? 'RESTRICTED' : 'UNKNOWN';
        const message = classified.reason;
        updates.push({ ...asset, status: appStatus, checked: now, healthNote: message });
        results.push({ id: asset.id, metaId, name: asset.name, type: asset.type, health, tokenLabel: resolved.record.label, message });
        events.push({ id: crypto.randomUUID(), assetId: asset.id, metaId, type: asset.type, health, tokenId: resolved.record.id, tokenLabel: resolved.record.label, error: message, errorCode: classified.code, errorSubcode: classified.subcode, checked: now });

        const updatedRecord = await updateMetaToken(workspaceOwner, resolved.record, {
          status: classified.status,
          lastCheckedAt: now,
          lastError: classified.reason,
          lastErrorCode: classified.code,
          lastErrorSubcode: classified.subcode,
        });
        tokenCache.set(updatedRecord.id, { record: updatedRecord, token: resolved.token });
        if (classified.status === 'invalid' || classified.status === 'rate_limited') {
          haltedTokens.set(updatedRecord.id, classified.reason);
        }
      }
    }

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
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
