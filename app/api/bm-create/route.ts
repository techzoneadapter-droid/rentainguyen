import { z } from 'zod';
import { audit, db, owner, put } from '../../../lib/server';
import {
  classifyMetaTokenError,
  getMetaTokenSecret,
  graphPostWithToken,
  graphWithToken,
  updateMetaToken,
  type MetaTokenRecord,
} from '../../../lib/meta-tokens';

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
  tokenId: z.string().uuid(),
  name: z.string().trim().min(2).max(100),
  primaryPage: z.string().regex(/^\d{5,30}$/),
  timezone: z.coerce.number().int().min(1).max(1000).default(140),
  vertical: z.enum(verticals).default('ADVERTISING'),
  purposeConfirmed: z.literal(true),
});

type MetaObject = Record<string, unknown>;
type ManagedPage = { id: string; name: string; tasks: string[] };

type TokenContext = {
  me: MetaObject;
  granted: Set<string>;
  pages: ManagedPage[];
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

async function getGrantedPermissions(token: string) {
  const response = await graphWithToken(token, 'me/permissions', { limit: '100' });
  const rows = Array.isArray(response.data) ? response.data : [];
  return new Set(
    rows
      .map((row) => objectValue(row))
      .filter((row) => stringValue(row.status).toLowerCase() === 'granted')
      .map((row) => stringValue(row.permission))
      .filter(Boolean),
  );
}

async function getManagedPages(token: string) {
  const pages = new Map<string, ManagedPage>();
  let after = '';

  for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
    const response = await graphWithToken(token, 'me/accounts', {
      fields: 'id,name,tasks',
      limit: '100',
      ...(after ? { after } : {}),
    });

    const rows = Array.isArray(response.data) ? response.data : [];
    for (const raw of rows) {
      const row = objectValue(raw);
      const id = stringValue(row.id);
      if (!/^\d{5,30}$/.test(id)) continue;
      pages.set(id, {
        id,
        name: stringValue(row.name) || 'Facebook Page',
        tasks: Array.isArray(row.tasks) ? row.tasks.map(String) : [],
      });
    }

    const paging = objectValue(response.paging);
    if (!stringValue(paging.next)) break;
    const cursors = objectValue(paging.cursors);
    after = stringValue(cursors.after);
    if (!after) break;
  }

  return Array.from(pages.values());
}

async function readTokenContext(token: string): Promise<TokenContext> {
  const me = await graphWithToken(token, 'me', { fields: 'id,name' });
  const granted = await getGrantedPermissions(token);
  const missing = ['business_management', 'pages_show_list'].filter((permission) => !granted.has(permission));
  if (missing.length) {
    const error = new Error(`Token thiếu quyền bắt buộc: ${missing.join(', ')}.`);
    error.name = 'MetaPermissionPreflightError';
    throw error;
  }
  const pages = await getManagedPages(token);
  return { me, granted, pages };
}

function isPermissionPreflightError(error: unknown) {
  return error instanceof Error && error.name === 'MetaPermissionPreflightError';
}

async function markFailure(
  user: string,
  record: MetaTokenRecord,
  error: unknown,
  patch: Partial<MetaTokenRecord> = {},
) {
  if (isPermissionPreflightError(error)) {
    return updateMetaToken(user, record, {
      status: 'permission_issue',
      lastCheckedAt: new Date().toISOString(),
      lastError: (error as Error).message,
      ...patch,
    });
  }

  const classified = classifyMetaTokenError(error);
  return updateMetaToken(user, record, {
    status: classified.status === 'unknown_error' ? record.status : classified.status,
    lastCheckedAt: new Date().toISOString(),
    lastError: classified.reason,
    lastErrorCode: classified.code,
    lastErrorSubcode: classified.subcode,
    ...patch,
  });
}

export async function GET(req: Request) {
  try {
    const workspaceOwner = await owner();
    const tokenId = new URL(req.url).searchParams.get('tokenId') || '';
    if (!z.string().uuid().safeParse(tokenId).success) {
      return Response.json({ error: 'Token nguồn không hợp lệ.' }, { status: 400 });
    }

    const source = await getMetaTokenSecret(workspaceOwner, tokenId);
    const now = new Date().toISOString();

    try {
      const context = await readTokenContext(source.token);
      const metaUserId = stringValue(context.me.id);
      const metaUserName = stringValue(context.me.name);
      const status = source.record.status === 'create_restricted' ? 'create_restricted' : 'active';

      await updateMetaToken(workspaceOwner, source.record, {
        status,
        metaUserId,
        metaUserName,
        lastCheckedAt: now,
        lastError: status === 'active' ? undefined : source.record.lastError,
        lastErrorCode: status === 'active' ? undefined : source.record.lastErrorCode,
        lastErrorSubcode: status === 'active' ? undefined : source.record.lastErrorSubcode,
      });

      return Response.json({
        user: { id: metaUserId, name: metaUserName },
        pages: context.pages,
        permissions: {
          businessManagement: context.granted.has('business_management'),
          pagesShowList: context.granted.has('pages_show_list'),
        },
        hint: context.pages.length
          ? undefined
          : 'Token hợp lệ nhưng không có Page quản lý nào được trả về. Meta yêu cầu một Page đại diện khi tạo Business Manager.',
      });
    } catch (error) {
      const updated = await markFailure(workspaceOwner, source.record, error);
      return Response.json(
        {
          error: isPermissionPreflightError(error)
            ? (error as Error).message
            : classifyMetaTokenError(error).reason,
          tokenStatus: updated.status,
          hint: 'Luồng này chỉ tạo Business Manager và yêu cầu business_management + pages_show_list. App không tự đổi token hoặc tự retry.',
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
    const source = await getMetaTokenSecret(workspaceOwner, input.tokenId);
    const now = new Date().toISOString();
    let currentRecord = source.record;

    let context: TokenContext;
    try {
      context = await readTokenContext(source.token);
      currentRecord = await updateMetaToken(workspaceOwner, currentRecord, {
        status: currentRecord.status === 'create_restricted' ? 'create_restricted' : 'active',
        metaUserId: stringValue(context.me.id),
        metaUserName: stringValue(context.me.name),
        lastCheckedAt: now,
        lastUsedAt: now,
      });
    } catch (error) {
      const updated = await markFailure(workspaceOwner, currentRecord, error, {
        lastUsedAt: now,
        lastCreateAt: now,
        lastCreateResult: 'failed_preflight',
      });
      return Response.json(
        {
          error: isPermissionPreflightError(error)
            ? (error as Error).message
            : classifyMetaTokenError(error).reason,
          tokenStatus: updated.status,
        },
        { status: 400 },
      );
    }

    const metaUserId = stringValue(context.me.id);
    if (!/^\d{5,30}$/.test(metaUserId)) {
      return Response.json({ error: 'Meta không trả về app-scoped User ID hợp lệ.' }, { status: 400 });
    }

    const selectedPage = context.pages.find((page) => page.id === input.primaryPage);
    if (!selectedPage) {
      return Response.json(
        { error: 'Page đã chọn không nằm trong danh sách Page mà token hiện quản lý. Hãy làm mới và chọn lại Page.' },
        { status: 400 },
      );
    }

    let createResult: MetaObject;
    try {
      createResult = await graphPostWithToken(source.token, `${metaUserId}/businesses`, {
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
          error: `${classified.reason} App chỉ gửi một yêu cầu tạo BM và không tự retry.`,
          tokenStatus: updated.status,
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
        lastError: 'Meta phản hồi yêu cầu tạo nhưng không trả Business ID.',
      });
      return Response.json(
        { error: 'Meta đã phản hồi nhưng không trả Business ID. Hãy kiểm tra Meta Business Settings trước khi thử lại.' },
        { status: 502 },
      );
    }

    let business: MetaObject = {};
    let healthNote = 'Business Manager được tạo qua Meta Graph API bằng token do người dùng tự cung cấp.';
    try {
      business = await graphWithToken(source.token, businessId, {
        fields: 'id,name,verification_status,created_time,primary_page,timezone_id,created_by,updated_time',
      });
    } catch (error) {
      healthNote += ` Đã nhận Business ID nhưng bước đọc lại thông tin thất bại: ${(error as Error).message}`;
    }

    const confirmedName = stringValue(business.name) || input.name;
    const verificationStatus = stringValue(business.verification_status) || 'unknown';
    const verified = verificationStatus.toLowerCase() === 'verified';
    const primaryPage = objectValue(business.primary_page);
    const createdBy = objectValue(business.created_by);
    const creationTime = stringValue(business.created_time) || now;
    const timezoneId = stringValue(business.timezone_id) || String(input.timezone);

    currentRecord = await updateMetaToken(workspaceOwner, currentRecord, {
      status: 'active',
      metaUserId,
      metaUserName: stringValue(context.me.name) || currentRecord.metaUserName || '',
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
          primaryPageId: stringValue(primaryPage.id) || selectedPage.id,
          primaryPageName: stringValue(primaryPage.name) || selectedPage.name,
          createdById: stringValue(createdBy.id) || metaUserId,
          createdByName: stringValue(createdBy.name) || stringValue(context.me.name),
          healthNote,
        }),
        audit(workspaceOwner, `Tạo Business Manager từ token: ${confirmedName} · token ${currentRecord.label}`),
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
        verificationStatus,
        verified,
        creationTime,
        timezoneId,
        primaryPage: {
          id: stringValue(primaryPage.id) || selectedPage.id,
          name: stringValue(primaryPage.name) || selectedPage.name,
        },
        createdBy: {
          id: stringValue(createdBy.id) || metaUserId,
          name: stringValue(createdBy.name) || stringValue(context.me.name),
        },
      },
      message: saved
        ? `Đã tạo Business Manager ${confirmedName} và lưu vào workspace.`
        : `Đã tạo Business Manager ${confirmedName} trên Meta (ID ${businessId}) nhưng chưa lưu được vào workspace.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: 'Token nguồn, tên BM, Page đại diện, timezone, vertical hoặc xác nhận mục đích không hợp lệ.' },
        { status: 400 },
      );
    }
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
