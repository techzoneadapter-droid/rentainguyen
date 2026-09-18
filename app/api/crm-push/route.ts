import { z } from 'zod';
import { env } from 'cloudflare:workers';
import type { Asset } from '../../../lib/data';
import { gatewayType, toGatewayResource } from '../../../lib/crm-gateway';
import { audit, db, list, owner, put } from '../../../lib/server';
import { redactSecrets } from '../../../lib/redact';

// Regex Meta ID: một backslash trong RegExp literal. Bản cũ /^\\d{5,30}$/ khớp
// ký tự '\d' literal nên không bao giờ match — mọi payload đều bị từ chối.
const pushSchema = z.object({
  metaIds: z.array(z.string().regex(/^\d{5,30}$/)).min(1).max(100),
});

// D1 batch bị chia chunk thay vì gửi hàng nghìn statement một lần.
const DB_CHUNK = 40;
const GATEWAY_TIMEOUT_MS = 20000;

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

function gatewayConfig() {
  const workerEnv = env as unknown as Record<string, string | undefined>;
  const url = workerEnv.BVAGC_RESOURCE_GATEWAY_URL || process.env.BVAGC_RESOURCE_GATEWAY_URL || '';
  const key = workerEnv.BVAGC_RESOURCE_API_KEY || process.env.BVAGC_RESOURCE_API_KEY || '';
  return { url, key, configured: Boolean(url && key) };
}

/** API key đi qua Authorization header, KHÔNG bao giờ nằm trong URL/query. */
function pushGateway(resources: Record<string, unknown>[], gateway: { url: string; key: string }) {
  return fetch(gateway.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${gateway.key}`,
    },
    body: JSON.stringify({ resources }),
    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
  });
}

type GatewayReply = {
  ok?: boolean;
  accepted?: Array<{ id?: string; code?: string; meta_id?: string; type?: string }>;
  rejected?: Array<{ code?: string; meta_id?: string; type?: string; error?: string }>;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function GET() {
  const gateway = gatewayConfig();
  return Response.json({
    // Không fake configured=true: thiếu URL/key => CRM local, chưa kết nối gateway.
    configured: gateway.configured,
    mode: gateway.configured ? 'EXTERNAL' : 'LOCAL_ONLY',
    endpoint: gateway.configured ? new URL(gateway.url).host : 'local-workspace',
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
    const selected = assets.filter((asset) => requested.has(asset.metaId || '') || requested.has(asset.id.match(/(?:^|:)meta:(\d{5,30})(?:$|:)/)?.[1] || asset.id.match(/(\d{5,30})$/)?.[1] || ''));
    if (!selected.length) throw new Error('Không tìm thấy tài nguyên đã chọn trong workspace.');

    const mapped = selected
      .map((asset) => ({ asset, resource: toGatewayResource(asset) }))
      .filter((item): item is { asset: Asset; resource: Record<string, unknown> } => Boolean(item.resource));

    if (!mapped.length) {
      throw new Error('CRM hiện chỉ nhận BM, tài khoản quảng cáo và Page có Meta ID hợp lệ.');
    }

    const gateway = gatewayConfig();
    const batchId = `${gateway.configured ? 'gw' : 'local'}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    let accepted: Array<Record<string, unknown>> = [];
    let rejected: Array<Record<string, unknown>> = [];
    let status: 'PUSHED' | 'PARTIAL' | 'FAILED' | 'LOCAL_ONLY';
    let message: string;

    if (!gateway.configured) {
      status = 'LOCAL_ONLY';
      message = `Đã lưu ${mapped.length} tài nguyên trong CRM local (batch ${batchId}). Chưa cấu hình BVAGC_RESOURCE_GATEWAY_URL nên chưa gửi ra ngoài.`;
      accepted = mapped.map(({ asset }) => ({
        action: 'LOCAL_ONLY',
        id: `local:${asset.metaId || asset.id}`,
        type: gatewayType(asset),
      }));
    } else {
      // Đẩy thật qua gateway. Lỗi mạng/5xx => FAILED cho lô này, KHÔNG fake PUSHED.
      try {
        const response = await pushGateway(
          mapped.map(({ resource }) => resource),
          gateway,
        );
        const reply = (await response.json().catch(() => ({}))) as GatewayReply;
        if (!response.ok) throw new Error(`Gateway trả HTTP ${response.status}.`);
        const rejectedRows = reply.rejected || [];
        const acceptedRows = reply.accepted || mapped.map((item) => ({ code: item.resource.code }));
        accepted = acceptedRows;
        rejected = rejectedRows;
        const okCount = mapped.length - rejected.length;
        if (rejected.length === 0) {
          status = 'PUSHED';
          message = `Đã đẩy ${mapped.length} tài nguyên sang CRM (batch ${batchId}).`;
        } else if (okCount > 0) {
          status = 'PARTIAL';
          message = `Đã đẩy ${okCount}/${mapped.length} tài nguyên sang CRM; ${rejected.length} bị từ chối.`;
        } else {
          status = 'FAILED';
          message = `CRM từ chối toàn bộ ${mapped.length} tài nguyên (batch ${batchId}).`;
        }
      } catch (gatewayError) {
        status = 'FAILED';
        rejected = mapped.map((item) => ({ code: item.resource.code, error: (gatewayError as Error).message }));
        message = `Không đẩy được sang CRM: ${redactSecrets((gatewayError as Error).message)}`;
      }
    }

    const updates = mapped.map(({ asset, resource }) => {
      const code = String(resource.code || '');
      const metaIdStr = String(resource.business_id || resource.account_id || resource.page_id || '');
      const failed = status === 'FAILED' || rejected.some((row) => {
        const rowCode = String((row as { code?: string }).code || '');
        const rowMetaId = String((row as { meta_id?: string }).meta_id || '');
        return (rowCode && rowCode === code) || (rowMetaId && rowMetaId === metaIdStr);
      });
      const crmPushStatus = status === 'LOCAL_ONLY' ? 'LOCAL_ONLY' : failed ? 'FAILED' : 'PUSHED';
      return put(workspaceOwner, 'asset', {
        ...asset,
        crmPushStatus,
        crmPushAt: now,
        crmResourceId: status === 'LOCAL_ONLY' ? `local:${asset.metaId || asset.id}` : code,
        crmBatchId: batchId,
        ...(crmPushStatus === 'FAILED' ? { healthNote: redactSecrets(message) } : {}),
      });
    });

    // Ghi D1 theo chunk; một chunk fail vẫn giữ kết quả đã lưu của các chunk trước.
    for (const part of chunk(updates, DB_CHUNK)) {
      await db().batch([...part, audit(workspaceOwner, redactSecrets(`${status === 'LOCAL_ONLY' ? 'Lưu CRM local' : 'Đẩy CRM'} ${mapped.length} tài nguyên · batch ${batchId}`))]);
    }

    return Response.json({
      ok: status !== 'FAILED',
      status,
      batchId,
      configured: gateway.configured,
      accepted,
      rejected,
      message,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Danh sách tài nguyên không hợp lệ (Meta ID chỉ gồm 5–30 chữ số).' }, { status: 400 });
    }
    return Response.json({ error: redactSecrets((error as Error).message) }, { status: 400 });
  }
}
