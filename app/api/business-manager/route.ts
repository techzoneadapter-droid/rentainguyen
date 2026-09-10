import { z } from 'zod';
import { audit, config, db, graph, graphPost, owner, put } from '../../../lib/server';

const verticals = [
  'ADVERTISING',
  'AUTOMOTIVE',
  'CONSUMER_PACKAGED_GOODS',
  'ECOMMERCE',
  'EDUCATION',
  'ENERGY_AND_UTILITIES',
  'ENTERTAINMENT_AND_MEDIA',
  'FINANCIAL_SERVICES',
  'GAMING',
  'GOVERNMENT_AND_POLITICS',
  'MARKETING',
  'ORGANIZATIONS_AND_ASSOCIATIONS',
  'PROFESSIONAL_SERVICES',
  'RETAIL',
  'TECHNOLOGY',
  'TELECOM',
  'TRAVEL',
  'OTHER',
] as const;

const createSchema = z.object({
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
    const connection = config();
    if (!connection.token) {
      return Response.json({ connected: false, version: connection.version });
    }

    const me = await graph('me', { fields: 'id,name' });
    return Response.json({
      connected: true,
      version: connection.version,
      user: { id: String(me.id || ''), name: String(me.name || '') },
    });
  } catch (error) {
    return Response.json(
      { connected: false, error: (error as Error).message },
      { status: 400 },
    );
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
  }

  try {
    const workspaceOwner = await owner();
    const input = createSchema.parse(await req.json());

    if (!config().token) {
      throw new Error('Chưa kết nối Meta. Hãy cấu hình META_ACCESS_TOKEN trên máy chủ trước.');
    }

    const me = await graph('me', { fields: 'id,name' });
    const metaUserId = String(me.id || '');
    if (!/^\d{5,30}$/.test(metaUserId)) {
      throw new Error('Meta không trả về app-scoped User ID hợp lệ.');
    }

    let result: Record<string, unknown>;
    try {
      result = await graphPost(`${metaUserId}/businesses`, {
        name: input.name,
        vertical: input.vertical,
        primary_page: input.primaryPage,
        timezone_id: String(input.timezone),
      });
    } catch (error) {
      const message = (error as Error).message;
      throw new Error(
        `${message} Không tự gửi lại yêu cầu tạo. Nếu đây là lỗi timeout/kết nối, hãy kiểm tra Meta Business Settings trước khi thử lại để tránh tạo trùng.`,
      );
    }

    const businessId = String(result.id || '');
    if (!/^\d{5,30}$/.test(businessId)) {
      throw new Error(
        'Meta đã phản hồi nhưng không trả Business ID. Cần kiểm tra Meta Business Settings trước khi thử lại.',
      );
    }

    let verified = false;
    let confirmedName = input.name;
    let healthNote = 'Business Manager vừa được tạo qua Meta Graph API.';
    try {
      const business = await graph(businessId, {
        fields: 'id,name,verification_status,creation_time',
      });
      verified = business.verification_status === 'verified';
      confirmedName = String(business.name || input.name);
    } catch (error) {
      healthNote = `Đã nhận Business ID từ Meta nhưng bước đọc lại thất bại: ${(error as Error).message}`;
    }

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
          checked: new Date().toISOString(),
          healthNote,
        }),
        audit(workspaceOwner, `Tạo Business Manager thật: ${confirmedName}`),
      ]);
    } catch {
      saved = false;
    }

    return Response.json({
      id: businessId,
      name: confirmedName,
      saved,
      message: saved
        ? `Đã tạo Business Manager ${confirmedName} trên Meta.`
        : `Business Manager đã được tạo trên Meta (ID ${businessId}) nhưng chưa lưu được vào workspace. Bấm Đồng bộ Meta để nạp lại.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: 'Tên BM, Page ID, timezone hoặc xác nhận mục đích không hợp lệ.' },
        { status: 400 },
      );
    }
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
