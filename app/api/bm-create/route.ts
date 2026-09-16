import { z } from 'zod';
import { audit, db, owner, put } from '../../../lib/server';
import {
  classifyMetaTokenError,
  createBusinessFromToken,
  getMetaTokenSecret,
  inspectUserToken,
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

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
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
      const context = await inspectUserToken(source.token);
      const status = source.record.status === 'create_restricted' ? 'create_restricted' : 'active';

      await updateMetaToken(workspaceOwner, source.record, {
        status,
        metaUserId: context.me.id,
        metaUserName: context.me.name,
        lastCheckedAt: now,
        lastError: status === 'active' ? undefined : source.record.lastError,
        lastErrorCode: status === 'active' ? undefined : source.record.lastErrorCode,
        lastErrorSubcode: status === 'active' ? undefined : source.record.lastErrorSubcode,
      });

      return Response.json({
        user: context.me,
        pages: context.pages,
        permissions: {
          businessManagement: context.permissions.includes('business_management'),
          pagesShowList: context.permissions.includes('pages_show_list'),
          granted: context.permissions,
        },
        debug: context.debug,
        warnings: context.warnings,
        hint: context.pages.length
          ? undefined
          : 'Token hợp lệ (/me OK) nhưng GET /me/accounts không có Page. Meta yêu cầu primary_page khi tạo BM.',
      });
    } catch (error) {
      const updated = await markFailure(workspaceOwner, source.record, error);
      return Response.json(
        {
          error: isPermissionPreflightError(error)
            ? (error as Error).message
            : classifyMetaTokenError(error).reason,
          tokenStatus: updated.status,
          hint: 'Luồng token-only: debug_token → GET /me → GET /me/accounts. Không dùng cookie, không OAuth dialog.',
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

    let created;
    try {
      created = await createBusinessFromToken(source.token, {
        name: input.name,
        vertical: input.vertical,
        primaryPage: input.primaryPage,
        timezoneId: input.timezone,
      });
    } catch (error) {
      const updated = await markFailure(workspaceOwner, currentRecord, error, {
        lastUsedAt: now,
        lastCreateAt: now,
        lastCreateResult: isPermissionPreflightError(error) ? 'failed_preflight' : 'failed',
      });
      const classified = classifyMetaTokenError(error);
      return Response.json(
        {
          error: isPermissionPreflightError(error)
            ? (error as Error).message
            : `${classified.reason} App chỉ gửi một yêu cầu tạo BM và không tự retry.`,
          tokenStatus: updated.status,
          metaError: { code: classified.code, subcode: classified.subcode },
        },
        { status: classified.code === 502 ? 502 : 400 },
      );
    }

    currentRecord = await updateMetaToken(workspaceOwner, currentRecord, {
      status: 'active',
      metaUserId: created.inspection.me.id,
      metaUserName: created.inspection.me.name,
      lastCheckedAt: now,
      lastUsedAt: now,
      lastCreateAt: now,
      lastCreateResult: `success:${created.id}`,
      lastError: undefined,
      lastErrorCode: undefined,
      lastErrorSubcode: undefined,
    });

    let saved = true;
    try {
      await db().batch([
        put(workspaceOwner, 'asset', {
          id: `${workspaceOwner}:meta:${created.id}`,
          metaId: created.id,
          name: created.name,
          type: 'BM',
          status: 'Truy cập được',
          verified: created.verified,
          verificationStatus: created.verificationStatus,
          country: 'Chưa rõ',
          tier: 'Chưa rõ',
          limit: 'Chưa rõ',
          parent: '',
          source: 'meta',
          checked: now,
          creationTime: created.createdTime,
          timezoneId: created.timezoneId,
          primaryPageId: created.primaryPage.id,
          primaryPageName: created.primaryPage.name,
          createdById: created.createdBy.id,
          createdByName: created.createdBy.name,
          sourceTokenId: currentRecord.id,
          healthNote: 'Tạo BM token-only: POST /{user-id}/businesses với access_token trên form, không cookie.',
        }),
        audit(workspaceOwner, `Tạo Business Manager từ token: ${created.name} · token ${currentRecord.label}`),
      ]);
    } catch {
      saved = false;
    }

    return Response.json({
      id: created.id,
      name: created.name,
      saved,
      tokenStatus: currentRecord.status,
      business: {
        id: created.id,
        name: created.name,
        verificationStatus: created.verificationStatus,
        verified: created.verified,
        creationTime: created.createdTime,
        timezoneId: created.timezoneId,
        primaryPage: created.primaryPage,
        createdBy: created.createdBy,
      },
      message: saved
        ? `Đã tạo Business Manager ${created.name} và lưu vào workspace.`
        : `Đã tạo Business Manager ${created.name} trên Meta (ID ${created.id}) nhưng chưa lưu được vào workspace.`,
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
