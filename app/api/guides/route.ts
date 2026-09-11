import { z } from 'zod';
import { audit, db, list, owner, put } from '../../../lib/server';

const DEFAULT_GUIDE_GATEWAY = 'https://bvagc.vercel.app/api/resource-guide-gateway';
const MAX_FILE_SIZE = 200 * 1024 * 1024;

const prepareSchema = z.object({
  action: z.literal('prepare_upload'),
  fileName: z.string().trim().min(1).max(180),
  fileSize: z.coerce.number().int().min(1).max(MAX_FILE_SIZE),
  contentType: z.string().trim().max(160).optional().default('application/octet-stream'),
});

const saveSchema = z.object({
  action: z.literal('save'),
  title: z.string().trim().min(2).max(180),
  category: z.string().trim().max(80).optional().default('Khác'),
  summary: z.string().trim().max(1200).optional().default(''),
  price: z.coerce.number().min(0).max(1_000_000_000),
  fileName: z.string().trim().min(1).max(180),
  fileSize: z.coerce.number().int().min(1).max(MAX_FILE_SIZE),
  contentType: z.string().trim().max(160).optional().default('application/octet-stream'),
  storageBucket: z.string().trim().min(1).max(100),
  storagePath: z.string().trim().min(1).max(1000),
  publicUrl: z.string().url().max(2500),
});

const idsSchema = z.object({
  action: z.enum(['push', 'delete']),
  ids: z.array(z.string().uuid()).min(1).max(100),
});

type GuideAsset = {
  id: string;
  title: string;
  category: string;
  summary: string;
  price: number;
  fileName: string;
  fileSize: number;
  contentType: string;
  storageBucket: string;
  storagePath: string;
  publicUrl: string;
  created: string;
  crmPushStatus?: string;
  crmPushAt?: string;
  crmGuideId?: string;
  crmGuideCode?: string;
  crmPushError?: string;
};

type GatewayResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  bucket?: string;
  path?: string;
  file_name?: string;
  file_size?: number;
  content_type?: string;
  signed_upload_url?: string;
  public_url?: string;
  expires_in_seconds?: number;
  batch_id?: string;
  accepted?: Array<{ index: number; local_id: string; id: string; code: string; action: string; public_url?: string }>;
  rejected?: Array<{ index: number; local_id?: string; error: string }>;
};

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

function gatewayConfig() {
  return {
    url: process.env.BVAGC_GUIDE_GATEWAY_URL || DEFAULT_GUIDE_GATEWAY,
    key: process.env.BVAGC_RESOURCE_API_KEY || '',
  };
}

async function callGateway(body: Record<string, unknown>) {
  const { url, key } = gatewayConfig();
  if (!key) throw new Error('Chưa cấu hình BVAGC_RESOURCE_API_KEY.');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bvagc-api-key': key,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = (await response.json().catch(() => ({ ok: false, error: `CRM HTTP ${response.status}` }))) as GatewayResponse;
  if (!response.ok || !data.ok) throw new Error(data.message || data.error || `CRM HTTP ${response.status}`);
  return data;
}

export async function GET() {
  try {
    const workspaceOwner = await owner();
    const guides = (await list(workspaceOwner, 'guide_asset')) as GuideAsset[];
    return Response.json({ guides });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 503 });
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
  }

  try {
    const workspaceOwner = await owner();
    const body = (await req.json()) as Record<string, unknown>;

    if (body.action === 'prepare_upload') {
      const input = prepareSchema.parse(body);
      const data = await callGateway({
        action: 'CREATE_UPLOAD',
        file_name: input.fileName,
        file_size: input.fileSize,
        content_type: input.contentType || 'application/octet-stream',
      });
      return Response.json({
        signedUploadUrl: data.signed_upload_url,
        storageBucket: data.bucket,
        storagePath: data.path,
        publicUrl: data.public_url,
        expiresInSeconds: data.expires_in_seconds,
      });
    }

    if (body.action === 'save') {
      const input = saveSchema.parse(body);
      const id = crypto.randomUUID();
      const value: GuideAsset = {
        id,
        title: input.title,
        category: input.category || 'Khác',
        summary: input.summary || '',
        price: input.price,
        fileName: input.fileName,
        fileSize: input.fileSize,
        contentType: input.contentType || 'application/octet-stream',
        storageBucket: input.storageBucket,
        storagePath: input.storagePath,
        publicUrl: input.publicUrl,
        created: new Date().toISOString(),
        crmPushStatus: 'Chưa đẩy',
      };
      await db().batch([
        put(workspaceOwner, 'guide_asset', value as unknown as Record<string, unknown>),
        audit(workspaceOwner, `Thêm bí kíp: ${value.title}`),
      ]);
      return Response.json({ guide: value, message: 'Đã lưu bí kíp vào workspace.' });
    }

    const input = idsSchema.parse(body);
    const guides = (await list(workspaceOwner, 'guide_asset')) as GuideAsset[];
    const chosen = guides.filter((guide) => input.ids.includes(guide.id));
    if (!chosen.length) throw new Error('Không tìm thấy bí kíp đã chọn.');

    if (input.action === 'delete') {
      await db().batch([
        ...chosen.map((guide) => db().prepare('DELETE FROM records WHERE owner = ? AND kind = ? AND id = ?').bind(workspaceOwner, 'guide_asset', guide.id)),
        audit(workspaceOwner, `Xóa ${chosen.length} bí kíp khỏi workspace`),
      ]);
      return Response.json({ message: `Đã xóa ${chosen.length} bí kíp khỏi workspace.` });
    }

    const batchId = `guide-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const result = await callGateway({
      action: 'IMPORT_GUIDES',
      batch_id: batchId,
      guides: chosen.map((guide) => ({
        local_id: guide.id,
        code: guide.crmGuideCode || `AF-BK-${guide.id.replace(/-/g, '').slice(0, 20)}`,
        title: guide.title,
        category: guide.category,
        summary: guide.summary,
        price: guide.price,
        file_name: guide.fileName,
        file_size: guide.fileSize,
        content_type: guide.contentType,
        file_path: guide.storagePath,
      })),
    });

    const accepted = new Map((result.accepted || []).map((item) => [item.local_id, item]));
    const rejected = new Map((result.rejected || []).map((item) => [item.local_id || chosen[item.index]?.id || '', item.error]));
    const now = new Date().toISOString();
    const updates = chosen.map((guide) => {
      const ok = accepted.get(guide.id);
      const pushError = rejected.get(guide.id);
      return put(workspaceOwner, 'guide_asset', {
        ...guide,
        crmPushStatus: ok ? 'Đã đẩy' : 'Lỗi',
        crmPushAt: now,
        crmGuideId: ok?.id || guide.crmGuideId || '',
        crmGuideCode: ok?.code || guide.crmGuideCode || '',
        crmPushError: pushError || '',
      } as unknown as Record<string, unknown>);
    });

    await db().batch([
      ...updates,
      audit(workspaceOwner, `Đẩy bí kíp sang CRM: ${accepted.size} thành công, ${rejected.size} lỗi · batch ${result.batch_id || batchId}`),
    ]);

    return Response.json({
      ok: true,
      accepted: result.accepted || [],
      rejected: result.rejected || [],
      message: `Đã đẩy ${accepted.size}/${chosen.length} bí kíp sang CRM. Bí kíp mới ở trạng thái DRAFT để Admin duyệt trước khi bán.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Dữ liệu bí kíp hoặc tệp tải lên không hợp lệ.' }, { status: 400 });
    }
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
