import { z } from 'zod';
import { audit, config, db, owner, put } from '../../../lib/server';
import {
  classifyMetaTokenError,
  getMetaTokenSecret,
  graphPostWithToken,
  graphWithToken,
  publicToken,
  updateMetaToken,
} from '../../../lib/meta-tokens';

const verticals = [
  'ADVERTISING', 'AUTOMOTIVE', 'CONSUMER_PACKAGED_GOODS', 'ECOMMERCE', 'EDUCATION',
  'ENERGY_AND_UTILITIES', 'ENTERTAINMENT_AND_MEDIA', 'FINANCIAL_SERVICES', 'GAMING',
  'GOVERNMENT_AND_POLITICS', 'MARKETING', 'ORGANIZATIONS_AND_ASSOCIATIONS',
  'PROFESSIONAL_SERVICES', 'RETAIL', 'TECHNOLOGY', 'TELECOM', 'TRAVEL', 'OTHER',
] as const;

const createSchema = z.object({
  tokenId: z.string().uuid(),
  name: z.string().trim().min(2).max(100),
  primaryPage: z.string().regex(/^\d{5,30}$/),
  timezone: z.coerce.number().int().min(1).max(1000).default(1),
  vertical: z.enum(verticals).default('ADVERTISING'),
  purposeConfirmed: z.literal(true),
});

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

export async function GET() {
  try {
    await owner();
    return Response.json({ version: config().version, tokenSource: 'vault' });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
  }

  try {
    const workspaceOwner = await owner();
    const input = createSchema.parse(await req.json());
    const source = await getMetaTokenSecret(workspaceOwner, input.tokenId);
    let currentRecord = source.record;
    const token = source.token;
    const now = new Date().toISOString();

    let me: Record<string, unknown>;
    try {
      me = await graphWithToken(token, 'me', { fields: 'id,name' });
      currentRecord = await updateMetaToken(workspaceOwner, currentRecord, {
        status: 'active',
        metaUserId: String(me.id || ''),
        metaUserName: String(me.name || ''),
        lastCheckedAt: now,
        lastUsedAt: now,
        lastError: undefined,
        lastErrorCode: undefined,
        lastErrorSubcode: undefined,
      });
    } catch (error) {
      const classified = classifyMetaTokenError(error);
      const updated = await updateMetaToken(workspaceOwner, currentRecord, {
        status: classified.status,
        lastCheckedAt: now,
        lastUsedAt: now,
        lastCreateAt: now,
        lastCreateResult: 'failed_before_create',
        lastError: classified.reason,
        lastErrorCode: classified.code,
        lastErrorSubcode: classified.subcode,
      });
      return Response.json(
        { error: classified.reason, tokenStatus: classified.status, token: publicToken(updated) },
        { status: 400 },
      );
    }

    const metaUserId = String(me.id || '');
    if (!/^\d{5,30}$/.test(metaUserId)) {
      throw new Error('Meta không trả về app-scoped User ID hợp lệ.');
    }

    let result: Record<string, unknown>;
    try {
      result = await graphPostWithToken(token, `${metaUserId}/businesses`, {
        name: input.name,
        vertical: input.vertical,
        primary_page: input.primaryPage,
        timezone_id: String(input.timezone),
      });
    } catch (error) {
      const classified = classifyMetaTokenError(error);
      const updated = await updateMetaToken(workspaceOwner, currentRecord, {
        status: classified.status === 'unknown_error' ? currentRecord.status : classified.status,
        lastUsedAt: now,
        lastCreateAt: now,
        lastCreateResult: 'failed',
        lastError: classified.reason,
        lastErrorCode: classified.code,
        lastErrorSubcode: classified.subcode,
      });
      return Response.json(
        {
          error: `${classified.reason} Không tự gửi lại yêu cầu. Nếu đây là lỗi timeout/kết nối, hãy kiểm tra Meta Business Settings trước khi thử lại để tránh tạo trùng.`,
          tokenStatus: updated.status,
          token: publicToken(updated),
        },
        { status: 400 },
      );
    }

    const businessId = String(result.id || '');
    if (!/^\d{5,30}$/.test(businessId)) {
      await updateMetaToken(workspaceOwner, currentRecord, {
        lastUsedAt: now,
        lastCreateAt: now,
        lastCreateResult: 'needs_review',
        lastError: 'Meta phản hồi nhưng không trả Business ID.',
      });
      throw new Error('Meta đã phản hồi nhưng không trả Business ID. Cần kiểm tra Meta Business Settings trước khi thử lại.');
    }

    let verified = false;
    let confirmedName = input.name;
    let healthNote = 'Business Manager vừa được tạo qua Meta Graph API.';
    try {
      const business = await graphWithToken(token, businessId, {
        fields: 'id,name,verification_status,creation_time',
      });
      verified = business.verification_status === 'verified';
      confirmedName = String(business.name || input.name);
    } catch (error) {
      healthNote = `Đã nhận Business ID từ Meta nhưng bước đọc lại thất bại: ${(error as Error).message}`;
    }

    currentRecord = await updateMetaToken(workspaceOwner, currentRecord, {
      status: 'active',
      metaUserId,
      metaUserName: String(me.name || currentRecord.metaUserName || ''),
      lastCheckedAt: now,
      lastUsedAt: now,
      lastCreateAt: now,
      lastCreateResult: `success:${businessId}`,
      lastError: undefined,
      lastErrorCode: undefined,
      lastErrorSubcode: undefined,
    });

    let saved = true;
    try {
      await db().batch([
        put(workspaceOwner, 'asset', {
          id: `${workspaceOwner}:meta:${businessId}`,
          name: confirmedName,
          type: 'BM',
          status: 'Truy cập được',
          verified,
          country: 'Chưa rõ',
          tier: 'Chưa rõ',
          limit: 'Chưa rõ',
          parent: '',
          source: 'meta',
          checked: now,
          healthNote,
        }),
        audit(workspaceOwner, `Tạo Business Manager thật: ${confirmedName} · token ${currentRecord.label}`),
      ]);
    } catch {
      saved = false;
    }

    return Response.json({
      id: businessId,
      name: confirmedName,
      saved,
      tokenStatus: 'active',
      message: saved
        ? `Đã tạo Business Manager ${confirmedName} trên Meta bằng token ${currentRecord.label}.`
        : `Business Manager đã được tạo trên Meta (ID ${businessId}) nhưng chưa lưu được vào workspace. Bấm Đồng bộ Meta để nạp lại.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: 'Token nguồn, tên BM, Page ID, timezone hoặc xác nhận mục đích không hợp lệ.' },
        { status: 400 },
      );
    }
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
