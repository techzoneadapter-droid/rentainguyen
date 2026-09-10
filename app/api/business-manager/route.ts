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
  adminEmail: z.string().trim().email().max(254).optional().or(z.literal('')),
  purposeConfirmed: z.literal(true),
});

type MetaObject = Record<string, unknown>;

type InviteResult = {
  requested: boolean;
  email?: string;
  status: 'not_requested' | 'pending' | 'failed';
  error?: string;
};

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

function objectValue(value: unknown): MetaObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as MetaObject : {};
}

function stringValue(value: unknown) {
  return value === undefined || value === null ? '' : String(value);
}

export async function GET(req: Request) {
  try {
    const workspaceOwner = await owner();
    const tokenId = new URL(req.url).searchParams.get('tokenId') || '';
    if (!tokenId) {
      return Response.json({ version: config().version, tokenSource: 'vault' });
    }
    if (!z.string().uuid().safeParse(tokenId).success) {
      return Response.json({ error: 'Token nguồn không hợp lệ.' }, { status: 400 });
    }

    const source = await getMetaTokenSecret(workspaceOwner, tokenId);
    try {
      const response = await graphWithToken(source.token, 'me/accounts', {
        fields: 'id,name,tasks',
        limit: '100',
      });
      const rows = Array.isArray(response.data) ? response.data : [];
      const pages = rows
        .map((row) => objectValue(row))
        .map((row) => ({
          id: stringValue(row.id),
          name: stringValue(row.name) || 'Facebook Page',
          tasks: Array.isArray(row.tasks) ? row.tasks.map(String) : [],
        }))
        .filter((page) => /^\d{5,30}$/.test(page.id));

      const updated = await updateMetaToken(workspaceOwner, source.record, {
        status: 'active',
        lastCheckedAt: new Date().toISOString(),
        lastError: undefined,
        lastErrorCode: undefined,
        lastErrorSubcode: undefined,
      });
      return Response.json({ pages, token: publicToken(updated) });
    } catch (error) {
      const classified = classifyMetaTokenError(error);
      const updated = await updateMetaToken(workspaceOwner, source.record, {
        status: classified.status,
        lastCheckedAt: new Date().toISOString(),
        lastError: classified.reason,
        lastErrorCode: classified.code,
        lastErrorSubcode: classified.subcode,
      });
      return Response.json(
        {
          error: classified.reason,
          tokenStatus: classified.status,
          token: publicToken(updated),
          hint: 'Để app tự liệt kê Page, token cần quyền pages_show_list. Bạn vẫn có thể nhập Page ID thủ công nếu token có quyền hợp lệ với Page đó.',
        },
        { status: 400 },
      );
    }
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
    const adminEmail = input.adminEmail || undefined;
    const source = await getMetaTokenSecret(workspaceOwner, input.tokenId);
    let currentRecord = source.record;
    const token = source.token;
    const now = new Date().toISOString();

    let me: MetaObject;
    try {
      me = await graphWithToken(token, 'me', { fields: 'id,name' });
      currentRecord = await updateMetaToken(workspaceOwner, currentRecord, {
        status: 'active',
        metaUserId: stringValue(me.id),
        metaUserName: stringValue(me.name),
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

    const metaUserId = stringValue(me.id);
    if (!/^\d{5,30}$/.test(metaUserId)) {
      throw new Error('Meta không trả về app-scoped User ID hợp lệ.');
    }

    let pageProbe: MetaObject;
    try {
      pageProbe = await graphWithToken(token, input.primaryPage, { fields: 'id,name' });
      if (stringValue(pageProbe.id) !== input.primaryPage) {
        throw new Error('Meta trả về Page ID không khớp với Page đã chọn.');
      }
    } catch (error) {
      const classified = classifyMetaTokenError(error);
      await updateMetaToken(workspaceOwner, currentRecord, {
        status: classified.status === 'unknown_error' ? currentRecord.status : classified.status,
        lastUsedAt: now,
        lastCreateAt: now,
        lastCreateResult: 'failed_page_precheck',
        lastError: `Page ${input.primaryPage} không vượt qua bước kiểm tra trước khi tạo BM: ${classified.reason}`,
        lastErrorCode: classified.code,
        lastErrorSubcode: classified.subcode,
      });
      return Response.json(
        {
          error: `Không gửi yêu cầu tạo BM vì Page ${input.primaryPage} không đọc được bằng token đã chọn. ${classified.reason}`,
          tokenStatus: currentRecord.status,
        },
        { status: 400 },
      );
    }

    let createResult: MetaObject;
    try {
      createResult = await graphPostWithToken(token, `${metaUserId}/businesses`, {
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
      const opaqueCreateError = classified.code === 1 && classified.subcode === 1690114;
      return Response.json(
        {
          error: opaqueCreateError
            ? `${classified.reason} App đã xác nhận token và Page đều đọc được trước khi gửi lệnh tạo. Vì Meta không cung cấp nguyên nhân cụ thể cho subcode này, app giữ token ở trạng thái hiện tại và không tự retry.`
            : `${classified.reason} Không tự gửi lại yêu cầu. Nếu đây là lỗi timeout/kết nối, hãy kiểm tra Meta Business Settings trước khi thử lại để tránh tạo trùng.`,
          tokenStatus: updated.status,
          token: publicToken(updated),
          page: { id: stringValue(pageProbe.id), name: stringValue(pageProbe.name) },
          metaError: { code: classified.code, subcode: classified.subcode },
        },
        { status: 400 },
      );
    }

    const businessId = stringValue(createResult.id);
    if (!/^\d{5,30}$/.test(businessId)) {
      await updateMetaToken(workspaceOwner, currentRecord, {
        lastUsedAt: now,
        lastCreateAt: now,
        lastCreateResult: 'needs_review',
        lastError: 'Meta phản hồi nhưng không trả Business ID.',
      });
      throw new Error('Meta đã phản hồi nhưng không trả Business ID. Cần kiểm tra Meta Business Settings trước khi thử lại.');
    }

    let business: MetaObject = {};
    let healthNote = 'Business Manager vừa được tạo qua Meta Graph API.';
    try {
      business = await graphWithToken(token, businessId, {
        fields: 'id,name,verification_status,creation_time,primary_page,timezone_id,created_by,updated_time',
      });
    } catch (error) {
      healthNote = `Đã nhận Business ID từ Meta nhưng bước đọc lại thông tin thất bại: ${(error as Error).message}`;
    }

    const confirmedName = stringValue(business.name) || input.name;
    const verificationStatus = stringValue(business.verification_status) || 'unknown';
    const verified = verificationStatus.toLowerCase() === 'verified';
    const primaryPage = objectValue(business.primary_page);
    const createdBy = objectValue(business.created_by);
    const primaryPageId = stringValue(primaryPage.id) || input.primaryPage;
    const primaryPageName = stringValue(primaryPage.name) || stringValue(pageProbe.name);
    const creationTime = stringValue(business.creation_time) || now;
    const timezoneId = stringValue(business.timezone_id) || String(input.timezone);

    const invite: InviteResult = adminEmail
      ? { requested: true, email: adminEmail, status: 'pending' }
      : { requested: false, status: 'not_requested' };

    if (adminEmail) {
      try {
        await graphPostWithToken(token, `${businessId}/business_users`, {
          email: adminEmail,
          role: 'ADMIN',
        });
        healthNote += ` Đã gửi lời mời ADMIN tới ${adminEmail}; người nhận cần chấp nhận lời mời của Meta.`;
      } catch (error) {
        const classified = classifyMetaTokenError(error);
        invite.status = 'failed';
        invite.error = classified.reason;
        healthNote += ` Tạo BM thành công nhưng gửi lời mời ADMIN thất bại: ${classified.reason}`;
        if (classified.status === 'invalid' || classified.status === 'permission_issue' || classified.status === 'rate_limited') {
          currentRecord = await updateMetaToken(workspaceOwner, currentRecord, {
            status: classified.status,
            lastError: `Mời ADMIN thất bại: ${classified.reason}`,
            lastErrorCode: classified.code,
            lastErrorSubcode: classified.subcode,
          });
        }
      }
    }

    const finalTokenStatus = invite.status === 'failed' && currentRecord.status !== 'active'
      ? currentRecord.status
      : 'active';

    currentRecord = await updateMetaToken(workspaceOwner, currentRecord, {
      status: finalTokenStatus,
      metaUserId,
      metaUserName: stringValue(me.name) || currentRecord.metaUserName || '',
      lastCheckedAt: now,
      lastUsedAt: now,
      lastCreateAt: now,
      lastCreateResult: invite.status === 'failed'
        ? `success:${businessId}:admin_invite_failed`
        : `success:${businessId}`,
      ...(invite.status === 'failed'
        ? {}
        : { lastError: undefined, lastErrorCode: undefined, lastErrorSubcode: undefined }),
    });

    let saved = true;
    try {
      await db().batch([
        put(workspaceOwner, 'asset', {
          id: `${workspaceOwner}:meta:${businessId}`,
          metaId: businessId,
          name: confirmedName,
          type: 'BM',
          status: 'Truy cập được',
          verified,
          verificationStatus,
          country: 'Chưa rõ',
          tier: 'Chưa rõ',
          limit: 'Chưa rõ',
          parent: '',
          source: 'meta',
          checked: now,
          creationTime,
          timezoneId,
          primaryPageId,
          primaryPageName,
          createdById: stringValue(createdBy.id) || metaUserId,
          createdByName: stringValue(createdBy.name) || stringValue(me.name),
          adminEmail: adminEmail || '',
          adminInviteStatus: invite.status,
          adminInviteError: invite.error || '',
          healthNote,
        }),
        audit(
          workspaceOwner,
          `Tạo Business Manager thật: ${confirmedName} · token ${currentRecord.label}${adminEmail ? ` · admin ${adminEmail}` : ''}`,
        ),
      ]);
    } catch {
      saved = false;
    }

    return Response.json({
      id: businessId,
      name: confirmedName,
      saved,
      tokenStatus: currentRecord.status,
      business: {
        id: businessId,
        name: confirmedName,
        status: 'Truy cập được',
        verificationStatus,
        verified,
        creationTime,
        timezoneId,
        primaryPage: { id: primaryPageId, name: primaryPageName },
        createdBy: {
          id: stringValue(createdBy.id) || metaUserId,
          name: stringValue(createdBy.name) || stringValue(me.name),
        },
      },
      invite,
      message: saved
        ? `Đã tạo Business Manager ${confirmedName} trên Meta bằng token ${currentRecord.label}.`
        : `Business Manager đã được tạo trên Meta (ID ${businessId}) nhưng chưa lưu được vào workspace. Bấm Đồng bộ Meta để nạp lại.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: 'Token nguồn, tên BM, Page đại diện, email admin, timezone hoặc xác nhận mục đích không hợp lệ.' },
        { status: 400 },
      );
    }
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
