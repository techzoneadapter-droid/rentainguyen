import { z } from 'zod';
import { inspectAccount } from '../../../lib/account-inspect';
import { createBusinessAccount } from '../../../lib/bm-profile';
import { getSessionCookieByUid, uidFromLabel } from '../../../lib/credential-vault';
import { audit, config, db, owner, put } from '../../../lib/server';
import {
  classifyMetaTokenError,
  getMetaTokenSecret,
  graphPostWithToken,
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
  primaryPage: z.union([z.string().regex(/^\d{5,30}$/), z.literal('')]).optional(),
  timezone: z.coerce.number().int().min(1).max(1000).default(1),
  vertical: z.enum(verticals).default('ADVERTISING'),
  adminEmail: z.string().trim().email().max(254).optional().or(z.literal('')),
  purposeConfirmed: z.literal(true),
});

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
    const uidHint = source.record.metaUserId || uidFromLabel(source.record.label);
    let cookie = '';
    try { cookie = await getSessionCookieByUid(workspaceOwner, uidHint); } catch { cookie = ''; }
    const inspection = await inspectAccount({ token: source.token, cookie: cookie || undefined });
    const updated = await updateMetaToken(workspaceOwner, source.record, {
      status: 'active',
      metaUserId: inspection.me.id,
      metaUserName: inspection.me.name,
      lastCheckedAt: new Date().toISOString(),
      lastError: undefined,
      lastErrorCode: undefined,
      lastErrorSubcode: undefined,
    });
    return Response.json({
      pages: inspection.pages,
      user: inspection.me,
      debug: inspection.debug,
      warnings: inspection.warnings,
      allowBlank: true,
      token: publicToken(updated),
    });
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
    const now = new Date().toISOString();

    const uidHint = source.record.metaUserId || uidFromLabel(source.record.label);
    let cookie = '';
    try { cookie = await getSessionCookieByUid(workspaceOwner, uidHint); } catch { cookie = ''; }

    let created;
    try {
      created = await createBusinessAccount({
        token: source.token,
        cookie: cookie || undefined,
        name: input.name,
        vertical: input.vertical,
        timezoneId: input.timezone,
        primaryPage: input.primaryPage || undefined,
      });
    } catch (error) {
      const classified = classifyMetaTokenError(error);
      const updated = await updateMetaToken(workspaceOwner, currentRecord, {
        status: classified.status === 'create_restricted' ? 'create_restricted' : currentRecord.status,
        lastUsedAt: now,
        lastCreateAt: now,
        lastCreateResult: classified.status === 'permission_issue' ? 'failed_preflight' : 'failed',
        lastError: classified.reason,
        lastErrorCode: classified.code,
        lastErrorSubcode: classified.subcode,
      });
      const opaqueCreateError = classified.code === 1 && classified.subcode === 1690114;
      return Response.json(
        {
          error: opaqueCreateError
            ? `${classified.reason} App đã xác nhận /me và /me/accounts trước khi POST /{user-id}/businesses.`
            : `${classified.reason} Không tự gửi lại yêu cầu.`,
          tokenStatus: updated.status,
          token: publicToken(updated),
          metaError: { code: classified.code, subcode: classified.subcode },
        },
        { status: classified.code === 502 ? 502 : 400 },
      );
    }

    const invite: InviteResult = adminEmail
      ? { requested: true, email: adminEmail, status: 'pending' }
      : { requested: false, status: 'not_requested' };

    let healthNote = 'Tạo BM token-only: POST /{user-id}/businesses với access_token form field.';
    if (adminEmail) {
      try {
        await graphPostWithToken(source.token, `${created.id}/business_users`, {
          email: adminEmail,
          role: 'ADMIN',
        });
        healthNote += ` Đã gửi lời mời ADMIN tới ${adminEmail}.`;
      } catch (error) {
        const classified = classifyMetaTokenError(error);
        invite.status = 'failed';
        invite.error = classified.reason;
        healthNote += ` Tạo BM thành công nhưng mời ADMIN thất bại: ${classified.reason}`;
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
      metaUserId: created.inspection.me.id,
      metaUserName: created.inspection.me.name,
      lastCheckedAt: now,
      lastUsedAt: now,
      lastCreateAt: now,
      lastCreateResult: invite.status === 'failed'
        ? `success:${created.id}:admin_invite_failed`
        : `success:${created.id}`,
      ...(invite.status === 'failed'
        ? {}
        : { lastError: undefined, lastErrorCode: undefined, lastErrorSubcode: undefined }),
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
          verified: false,
          verificationStatus: 'unknown',
          country: 'Chưa rõ',
          tier: 'BM trắng',
          limit: 'Chưa rõ',
          parent: '',
          source: 'meta',
          checked: now,
          creationTime: now,
          timezoneId: String(input.timezone),
          primaryPageId: input.primaryPage || '',
          primaryPageName: '',
          createdById: created.inspection.me.id,
          createdByName: created.inspection.me.name,
          adminEmail: adminEmail || '',
          adminInviteStatus: invite.status,
          adminInviteError: invite.error || '',
          sourceTokenId: currentRecord.id,
          adAccountCount: 0,
          pageCount: input.primaryPage ? 1 : 0,
          userCount: 1,
          healthNote: `Tạo BM ${created.source === 'cookie' ? 'bằng cookie session' : 'bằng Graph'} — ${input.primaryPage ? 'có Page' : 'BM trắng không Page'}.`,
        }),
        audit(
          workspaceOwner,
          `Tạo Business Manager thật: ${created.name} · token ${currentRecord.label}${adminEmail ? ` · admin ${adminEmail}` : ''}`,
        ),
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
        status: 'Truy cập được',
        verificationStatus: 'unknown',
        verified: false,
        creationTime: now,
        timezoneId: String(input.timezone),
        primaryPage: { id: input.primaryPage || '', name: '' },
        createdBy: created.inspection.me,
      },
      invite,
      message: saved
        ? `Đã tạo Business Manager ${created.name} (${created.source === 'cookie' ? 'cookie session' : 'Graph'}${input.primaryPage ? '' : ', BM trắng không Page'}).`
        : `Business Manager đã được tạo trên Meta (ID ${created.id}) nhưng chưa lưu được vào workspace. Bấm Đồng bộ Meta để nạp lại.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: 'Token nguồn, tên BM, timezone hoặc xác nhận mục đích không hợp lệ.' },
        { status: 400 },
      );
    }
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
