import { z } from 'zod';
import type { Asset } from '../../../lib/data';
import { audit, db, list, owner, put } from '../../../lib/server';

const pushSchema = z.object({
  metaIds: z.array(z.string().regex(/^\\d{5,30}$/)).min(1).max(100),
});

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

function metaId(asset: Asset) {
  if (asset.metaId && /^\\d{5,30}$/.test(asset.metaId)) return asset.metaId;
  const match = asset.id.match(/(?:^|:)meta:(\\d{5,30})(?:$|:)/) || asset.id.match(/(\\d{5,30})$/);
  return match?.[1] || '';
}

function gatewayType(asset: Asset) {
  if (asset.type === 'BM' || asset.type === 'TKQC') return asset.type;
  if (asset.type === 'Page') return 'PAGE';
  return '';
}

function technicalStatus(status: string) {
  const value = String(status || '').toLowerCase();
  if (status === 'LIVE' || value.includes('truy cập') || value.includes('truy cáº­p')) return 'LIVE';
  if (status === 'DIE' || value.includes('disabled') || value.includes('vô hiệu')) return 'DISABLED';
  if (value.includes('hạn chế') || value.includes('háº¡n cháº¿') || value.includes('restricted')) return 'RESTRICTED';
  if (value.includes('cần kiểm tra quyền') || value.includes('cáº§n kiá»ƒm tra quyá»n') || value.includes('access lost')) return 'ACCESS_LOST';
  return 'UNKNOWN';
}

function numericTier(tier: string) {
  const match = String(tier || '').match(/^BM(\\d+)$/i);
  return match ? Number(match[1]) : undefined;
}

function cleanCountry(country: string) {
  const value = String(country || '').trim();
  if (!value || value.toLowerCase().includes('chưa') || value.toLowerCase().includes('chÆ°a')) return undefined;
  return value;
}

function deliveryLink(type: string, id: string) {
  if (type === 'BM') return `https://business.facebook.com/settings/?business_id=${id}`;
  if (type === 'TKQC') return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${id}`;
  return `https://www.facebook.com/${id}`;
}

function toGatewayResource(asset: Asset) {
  const id = metaId(asset);
  const type = gatewayType(asset);
  if (!id || !type) return null;

  const base: Record<string, unknown> = {
    type,
    code: `AW-${type}-${id.slice(-14)}`,
    name: asset.name,
    technical_status: technicalStatus(asset.status),
    country: cleanCountry(asset.country),
    health_score: technicalStatus(asset.status) === 'LIVE' ? 90 : 60,
    external_profile_id: deliveryLink(type, id),
  };

  if (type === 'BM') {
    base.business_id = id;
    base.verification_status = asset.verificationStatus
      ? String(asset.verificationStatus).toUpperCase()
      : asset.verified
        ? 'VERIFIED'
        : 'UNVERIFIED';
    if (/^BM\\d+$/i.test(String(asset.tier || ''))) base.bm_type = asset.tier;
    const limit = numericTier(asset.tier);
    if (limit !== undefined) base.account_limit = limit;
    base.operation_region = cleanCountry(asset.country);
  } else if (type === 'TKQC') {
    base.account_id = id;
    base.ownership_type = asset.parent ? 'BUSINESS' : 'PERSONAL';
    if (asset.currency) base.currency = asset.currency;
  } else {
    base.page_id = id;
  }

  return base;
}

export async function GET() {
  return Response.json({
    configured: true,
    endpoint: 'local-workspace',
  });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
  }

  try {
    const input = pushSchema.parse(await req.json());
    const workspaceOwner = await owner();
    const assets = (await list(workspaceOwner, 'asset')) as Asset[];
    const requested = new Set(input.metaIds);
    const selected = assets.filter((asset) => requested.has(metaId(asset)));
    if (!selected.length) throw new Error('Không tìm thấy tài nguyên đã chọn trong workspace.');

    const mapped = selected
      .map((asset) => ({ asset, resource: toGatewayResource(asset) }))
      .filter((item): item is { asset: Asset; resource: Record<string, unknown> } => Boolean(item.resource));

    if (!mapped.length) {
      throw new Error('CRM hiện chỉ nhận BM, tài khoản quảng cáo và Page có Meta ID hợp lệ.');
    }

    const batchId = `local-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const accepted = mapped.map(({ asset }, index) => ({
      index,
      type: gatewayType(asset),
      meta_id: metaId(asset),
      action: 'LOCAL_ONLY',
      id: `local:${metaId(asset)}`,
    }));
    const updates = mapped.map(({ asset }) => put(workspaceOwner, 'asset', {
      ...asset,
      crmPushStatus: 'LOCAL_ONLY',
      crmPushAt: now,
      crmResourceId: `local:${metaId(asset)}`,
      crmBatchId: batchId,
    }));

    await db().batch([
      ...updates,
      audit(workspaceOwner, `Lưu CRM local ${mapped.length} tài nguyên · batch ${batchId} • không gửi ra ngoài`),
    ]);

    return Response.json({
      ok: true,
      status: 'LOCAL_ONLY',
      batchId,
      accepted,
      rejected: [],
      message: `Đã lưu ${mapped.length} tài nguyên trong workspace. Không đẩy dữ liệu ra CRM/gateway bên ngoài.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Danh sách tài nguyên không hợp lệ.' }, { status: 400 });
    }
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
