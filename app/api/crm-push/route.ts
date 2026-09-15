import { env } from 'cloudflare:workers';
import { z } from 'zod';
import type { Asset } from '../../../lib/data';
import { audit, db, list, owner, put } from '../../../lib/server';

const DEFAULT_GATEWAY = 'https://zcxoennnjizibvzokwaz.supabase.co/functions/v1/resource-supply-gateway';

const pushSchema = z.object({
  metaIds: z.array(z.string().regex(/^\d{5,30}$/)).min(1).max(100),
});

type GatewayResult = {
  ok?: boolean;
  status?: string;
  batch_id?: string;
  accepted?: Array<{ index: number; type: string; meta_id: string; action: string; id: string }>;
  rejected?: Array<{ index: number; error: string }>;
  error?: string;
  message?: string;
};

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

function runtimeConfig() {
  const runtime = env as unknown as Record<string, string | undefined>;
  return {
    apiKey: runtime.BVAGC_RESOURCE_API_KEY || process.env.BVAGC_RESOURCE_API_KEY || '',
    gateway: runtime.BVAGC_RESOURCE_GATEWAY_URL || process.env.BVAGC_RESOURCE_GATEWAY_URL || DEFAULT_GATEWAY,
  };
}

function metaId(asset: Asset) {
  if (asset.metaId && /^\d{5,30}$/.test(asset.metaId)) return asset.metaId;
  const match = asset.id.match(/(?:^|:)meta:(\d{5,30})(?:$|:)/) || asset.id.match(/(\d{5,30})$/);
  return match?.[1] || '';
}

function gatewayType(asset: Asset) {
  if (asset.type === 'BM' || asset.type === 'TKQC') return asset.type;
  if (asset.type === 'Page') return 'PAGE';
  return '';
}

function technicalStatus(status: string) {
  const value = String(status || '').toLowerCase();
  if (status === 'LIVE' || value.includes('truy cập')) return 'LIVE';
  if (status === 'DIE' || value.includes('disabled') || value.includes('vô hiệu')) return 'DISABLED';
  if (value.includes('hạn chế') || value.includes('restricted')) return 'RESTRICTED';
  if (value.includes('cần kiểm tra quyền') || value.includes('access lost')) return 'ACCESS_LOST';
  return 'UNKNOWN';
}

function numericTier(tier: string) {
  const match = String(tier || '').match(/^BM(\d+)$/i);
  return match ? Number(match[1]) : undefined;
}

function cleanCountry(country: string) {
  const value = String(country || '').trim();
  if (!value || value.toLowerCase().includes('chưa')) return undefined;
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
    if (/^BM\d+$/i.test(String(asset.tier || ''))) base.bm_type = asset.tier;
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
  const connection = runtimeConfig();
  return Response.json({
    configured: Boolean(connection.apiKey),
    endpoint: connection.gateway,
    mode: connection.apiKey ? 'external-gateway' : 'not-configured',
  });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
  }

  try {
    const connection = runtimeConfig();
    if (!connection.apiKey) {
      return Response.json(
        { error: 'Chưa cấu hình BVAGC_RESOURCE_API_KEY. Hãy tạo khóa kết nối trong BVAGC CRM rồi lưu khóa ở server của app nguồn.' },
        { status: 503 },
      );
    }

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

    const batchId = `ads-workspace-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const response = await fetch(connection.gateway, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bvagc-api-key': connection.apiKey,
      },
      body: JSON.stringify({ batch_id: batchId, resources: mapped.map((item) => item.resource) }),
      signal: AbortSignal.timeout(25000),
    });

    const result = (await response.json().catch(() => ({ ok: false, error: 'INVALID_GATEWAY_RESPONSE' }))) as GatewayResult;
    if (!response.ok || !result.ok) {
      throw new Error(result.message || result.error || `CRM gateway HTTP ${response.status}`);
    }

    const acceptedByMeta = new Map((result.accepted || []).map((item) => [item.meta_id, item]));
    const now = new Date().toISOString();
    const updates = mapped
      .filter(({ asset }) => acceptedByMeta.has(metaId(asset)))
      .map(({ asset }) => {
        const accepted = acceptedByMeta.get(metaId(asset));
        return put(workspaceOwner, 'asset', {
          ...asset,
          crmPushStatus: accepted?.action || 'ACCEPTED',
          crmPushAt: now,
          crmResourceId: accepted?.id || '',
          crmBatchId: batchId,
        });
      });

    await db().batch([
      ...updates,
      audit(
        workspaceOwner,
        `Push BVAGC CRM: ${result.accepted?.length || 0} thành công, ${result.rejected?.length || 0} lỗi · batch ${batchId}`,
      ),
    ]);

    return Response.json({
      ok: true,
      status: result.status,
      batchId,
      accepted: result.accepted || [],
      rejected: result.rejected || [],
      message: `Đã gửi ${result.accepted?.length || 0}/${mapped.length} tài nguyên tới BVAGC CRM. Giá bán và trạng thái thương mại do CRM quản lý, app nguồn chỉ đồng bộ dữ liệu kỹ thuật.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Danh sách tài nguyên không hợp lệ.' }, { status: 400 });
    }
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
