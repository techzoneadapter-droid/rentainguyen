import { z } from 'zod';
import type { AccountSnapshot, StoredAccountSnapshot } from '../../../lib/account-snapshot';
import { discoverAccountSnapshot, toStoredAccountSnapshot } from '../../../lib/account-snapshot';
import { inspectAccount } from '../../../lib/account-inspect';
import { generateBmAccessLink } from '../../../lib/bm-access-link';
import { applyBmProfile, createBusinessAccount, prepareCookieSession, readBmProfile } from '../../../lib/bm-profile';
import type { Asset } from '../../../lib/data';
import { MetaCreationError, toStructuredMetaError, type StructuredMetaError } from '../../../lib/meta-errors';
import { canonicalOpenUrl, runIndependentBatch } from '../../../lib/resource-model';
import { redactSecrets } from '../../../lib/redact';
import { pushBmToShop } from '../../../lib/shop-online';
import { getSessionCookieByUid, uidFromLabel } from '../../../lib/credential-vault';
import { audit, config, list, owner, put } from '../../../lib/server';
import {
  classifyMetaTokenError,
  encryptToken,
  getMetaTokenSecret,
  looksLikeBusinessLimit,
  MetaTokenError,
  publicToken,
  tokenFingerprint,
  graphPostWithToken,
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
  mode: z.enum(['manual', 'semi_auto', 'auto']).default('manual'),
  name: z.string().trim().min(2).max(100),
  namePattern: z.string().trim().min(2).max(100).optional(),
  count: z.number().int().min(1).max(100).default(1),
  stopOnLimit: z.boolean().default(false),
  primaryPage: z.union([z.string().regex(/^\d{5,30}$/), z.literal('')]).optional(),
  timezone: z.coerce.number().int().min(1).max(1000).default(140),
  vertical: z.enum(verticals).default('ADVERTISING'),
  adminEmail: z.string().trim().email().max(254).optional().or(z.literal('')),
  delayMs: z.number().int().min(0).max(30000).default(0),
  continueOnError: z.boolean().default(false),
  maxConsecutiveErrors: z.number().int().min(1).max(10).default(3),
  autoCheckProfile: z.boolean().default(true),
  autoSync: z.boolean().default(true),
  autoGenerateAccessLink: z.boolean().default(false),
  autoPushShop: z.boolean().default(false),
  purposeConfirmed: z.literal(true),
});

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generatedName(input: z.infer<typeof createSchema>, index: number) {
  if (input.mode === 'manual' || input.count === 1) return input.name;
  const pattern = input.namePattern || `${input.name} {n}`;
  return pattern
    .replaceAll('{name}', input.name)
    .replaceAll('{n}', String(index + 1))
    .replaceAll('{index}', String(index + 1));
}

function isBusinessLimitFailure(error: unknown) {
  if (error instanceof MetaCreationError) {
    return error.errors.some((item) => looksLikeBusinessLimit(item.message, item.metaSubcode));
  }
  return classifyMetaTokenError(error).status === 'create_restricted';
}

async function credentialContext(workspaceOwner: string, tokenId: string, forceRefresh = false) {
  const source = await getMetaTokenSecret(workspaceOwner, tokenId);
  const uidHint = source.record.metaUserId || uidFromLabel(source.record.label);
  let cookie = '';
  try { cookie = await getSessionCookieByUid(workspaceOwner, uidHint); } catch { cookie = ''; }
  const stored = await list(workspaceOwner, 'account-snapshot') as StoredAccountSnapshot[];
  let snapshot = stored.find((item) => item.tokenId === tokenId);
  let runtimeSnapshot: AccountSnapshot | undefined;
  if (!snapshot || forceRefresh) {
    runtimeSnapshot = await discoverAccountSnapshot({ token: source.token, cookie: cookie || undefined });
    snapshot = toStoredAccountSnapshot(workspaceOwner, tokenId, runtimeSnapshot);
    const workingToken = runtimeSnapshot.workingCredential.token || source.token;
    const updatedRecord = {
      ...source.record,
      encrypted: await encryptToken(workingToken),
      fingerprint: await tokenFingerprint(workingToken),
      status: 'active' as const,
      metaUserId: snapshot.actor.id,
      metaUserName: snapshot.actor.name,
      lastCheckedAt: snapshot.capturedAt,
      lastError: undefined,
      lastErrorCode: undefined,
      lastErrorSubcode: undefined,
      updated: new Date().toISOString(),
    };
    await Promise.all([
      put(workspaceOwner, 'account-snapshot', snapshot).run(),
      put(workspaceOwner, 'meta-token', updatedRecord).run(),
    ]);
    source.token = workingToken;
    source.record = updatedRecord;
  }
  return { source, cookie, snapshot, runtimeSnapshot };
}

export async function GET(req: Request) {
  try {
    const workspaceOwner = await owner();
    const tokenId = new URL(req.url).searchParams.get('tokenId') || '';
    if (!tokenId) return Response.json({ version: config().version, tokenSource: 'vault' });
    if (!z.string().uuid().safeParse(tokenId).success) return Response.json({ error: 'Token nguồn không hợp lệ.' }, { status: 400 });

    // Preflight nhẹ: /me + quyền + Page qua Graph, song song cookie session nếu có.
    // Không quét owned/client từng BM như Account Snapshot đầy đủ, nên trả lời nhanh
    // và không tự gây rate limit khi tài khoản đã có nhiều BM.
    const source = await getMetaTokenSecret(workspaceOwner, tokenId);
    const uidHint = source.record.metaUserId || uidFromLabel(source.record.label);
    let cookie = '';
    try { cookie = await getSessionCookieByUid(workspaceOwner, uidHint); } catch { cookie = ''; }
    const inspection = await inspectAccount({ token: source.token, cookie: cookie || undefined });

    let record = source.record;
    if (inspection.workingToken && inspection.workingToken !== source.token) {
      record = await updateMetaToken(workspaceOwner, source.record, {
        encrypted: await encryptToken(inspection.workingToken),
        fingerprint: await tokenFingerprint(inspection.workingToken),
        status: 'active',
        metaUserId: inspection.me.id,
        metaUserName: inspection.me.name,
        lastCheckedAt: new Date().toISOString(),
        lastError: undefined,
        lastErrorCode: undefined,
        lastErrorSubcode: undefined,
      });
      source.token = inspection.workingToken;
    }

    const confirmed = inspection.confirmedPermissions;
    return Response.json({
      pages: inspection.pages.map((page) => ({ id: page.id, name: page.name, tasks: page.tasks || [] })),
      user: inspection.me,
      confirmedPermissions: confirmed,
      inferredPermissions: inspection.inferredPermissions,
      permissions: {
        businessManagement: confirmed.includes('business_management'),
        pagesShowList: confirmed.includes('pages_show_list'),
        confirmed,
        inferred: inspection.inferredPermissions,
      },
      warnings: inspection.warnings,
      allowBlank: true,
      snapshotAt: new Date().toISOString(),
      token: publicToken(record),
    });
  } catch (error) {
    return Response.json({ error: redactSecrets((error as Error).message) }, { status: 400 });
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
  try {
    const workspaceOwner = await owner();
    const input = createSchema.parse(await req.json());
    const count = input.mode === 'manual' ? 1 : input.count;
    const context = await credentialContext(workspaceOwner, input.tokenId, false);
    let currentRecord = context.source.record;
    const jobs = Array.from({ length: count }, (_, index) => ({ index, name: generatedName(input, index) }));
    // Cookie session đọc đúng một lần cho cả batch: uid + fb_dtsg + token nhúng.
    const preparedSession = await prepareCookieSession(context.cookie || undefined);

    const batch = await runIndependentBatch(jobs, async (job) => {
      if (job.index > 0 && input.delayMs) await sleep(input.delayMs);
      const diagnostics: StructuredMetaError[] = [];
      const created = await createBusinessAccount({
        token: context.source.token,
        cookie: context.cookie || undefined,
        session: preparedSession,
        name: job.name,
        vertical: input.vertical,
        timezoneId: input.timezone,
        primaryPage: input.primaryPage || undefined,
        snapshot: context.snapshot,
      });
      diagnostics.push(...created.errors);
      const now = new Date().toISOString();
      // Credential continuity: post-create (invite/readback/sync) phải dùng đúng
      // credential đã tạo được BM. Nếu token gốc A fail và BM được tạo bởi
      // session B thì tuyệt đối không quay lại A. Credential chỉ tồn tại server-side.
      const postCreate = created.credential;
      const postCreateToken = postCreate.token;
      let asset: Asset = {
        id: `${workspaceOwner}:meta:${created.id}`,
        metaId: created.id,
        name: created.name,
        type: 'BM',
        status: 'Truy cập được',
        verified: false,
        verificationStatus: 'unknown',
        country: 'Chưa rõ',
        tier: 'UNKNOWN',
        bmType: 'UNKNOWN',
        accountCapacity: null,
        limit: 'unknown',
        parent: '',
        source: 'meta',
        checked: now,
        creationTime: now,
        timezoneId: String(input.timezone),
        primaryPageId: input.primaryPage || '',
        primaryPageName: context.snapshot.pages.find((page) => page.id === input.primaryPage)?.name || '',
        createdById: context.snapshot.actor.id,
        createdByName: context.snapshot.actor.name,
        adminEmail: input.adminEmail || '',
        adminInviteStatus: input.adminEmail ? 'pending' : 'not_requested',
        sourceTokenId: currentRecord.id,
        adAccountCount: 0,
        pageCount: input.primaryPage ? 1 : 0,
        currencies: [],
        currencyMode: 'NONE',
        currency: 'NONE',
        assetSources: [],
        accessLinkStatus: 'none',
        shopStatus: 'not_ready',
        creationStatus: 'created',
        checkStatus: input.autoCheckProfile ? 'pending' : 'ready',
        syncStatus: input.autoSync ? 'pending' : 'ready',
        healthNote: `Tạo BM bằng ${created.source}; dùng cùng working credential của Account Snapshot.`,
      };
      asset.openUrl = canonicalOpenUrl(asset);
      const invite: { requested: boolean; email?: string; status: 'pending' | 'not_requested' | 'failed'; error?: string } = input.adminEmail
        ? { requested: true, email: input.adminEmail, status: 'pending' }
        : { requested: false, status: 'not_requested' };
      if (input.adminEmail && !postCreateToken) {
        invite.status = 'failed';
        invite.error = 'BM được tạo bằng cookie session không nhúng token Graph nên chưa mời admin được. Mời trong Business Settings hoặc đồng bộ lại rồi mời.';
        asset.adminInviteStatus = 'failed';
        asset.adminInviteError = invite.error;
      } else if (input.adminEmail) {
        try {
          await graphPostWithToken(postCreateToken, `${created.id}/business_users`, { email: input.adminEmail, role: 'ADMIN' });
        } catch (error) {
          invite.status = 'failed';
          invite.error = redactSecrets((error as Error).message);
          asset.adminInviteStatus = 'failed';
          asset.adminInviteError = invite.error;
        }
      }

      if ((input.autoCheckProfile || input.autoSync) && !postCreateToken) {
        diagnostics.push(toStructuredMetaError(new Error('Không đọc lại profile: BM tạo bằng session mà session không nhúng token Graph. Chạy Đồng bộ token để recovery bằng Account Snapshot.'), { source: 'session', stage: 'readback' }));
        asset.checkStatus = 'failed';
        asset.syncStatus = 'failed';
      } else if (input.autoCheckProfile || input.autoSync) {
        try {
          asset = applyBmProfile(asset, await readBmProfile(postCreateToken, created.id));
          asset.checkStatus = 'ready';
          asset.syncStatus = 'ready';
        } catch (error) {
          diagnostics.push(toStructuredMetaError(error, { source: 'graph', stage: 'readback' }));
          asset.checkStatus = 'failed';
          asset.syncStatus = 'failed';
        }
      }

      if (input.autoGenerateAccessLink) {
        try {
          asset.accessLinkStatus = 'generating';
          asset.accessLink = await generateBmAccessLink(asset);
          asset.accessLinkStatus = 'ready';
          asset.accessLinkGeneratedAt = new Date().toISOString();
          asset.accessLinkError = '';
          asset.shopStatus = 'ready';
        } catch (error) {
          asset.accessLinkStatus = 'failed';
          asset.accessLinkError = redactSecrets((error as Error).message);
          asset.shopStatus = 'not_ready';
        }
      }

      if (input.autoPushShop && asset.accessLinkStatus === 'ready') {
        try {
          asset.shopStatus = 'pushing';
          const pushed = await pushBmToShop(asset);
          asset.shopStatus = 'pushed';
          asset.shopProductId = pushed.productId;
          asset.shopSyncedAt = new Date().toISOString();
          asset.shopError = '';
        } catch (error) {
          asset.shopStatus = 'failed';
          asset.shopError = redactSecrets((error as Error).message);
        }
      }

      // saved=true CHỈ khi persist thành công. Meta tạo OK mà DB lỗi là
      // PARTIAL_SUCCESS: báo đúng thực tế, không retry create (tránh tạo duplicate).
      let persisted = true;
      let persistError = '';
      try {
        await put(workspaceOwner, 'asset', asset).run();
      } catch (error) {
        persisted = false;
        persistError = redactSecrets((error as Error).message);
        diagnostics.push(toStructuredMetaError(error, { source: 'app', stage: 'persist' }));
      }
      return {
        id: created.id,
        name: created.name,
        source: created.source,
        asset,
        diagnostics,
        invite,
        persisted,
        persistError,
        credentialKind: postCreate.kind,
      };
    }, {
      continueOnError: input.continueOnError,
      maxConsecutiveErrors: input.maxConsecutiveErrors,
      // Chạm giới hạn tạo BM của Meta thì dừng nguyên batch ngay, không đốt thêm lượt gọi.
      ...(input.stopOnLimit ? { stopOnError: isBusinessLimitFailure } : {}),
    });

    const successes = batch.filter((result) => result.ok);
    const failures = batch.filter((result) => !result.ok).map((result) => {
      const errors = result.error instanceof MetaCreationError
        ? result.error.errors
        : [toStructuredMetaError(result.error, { source: 'app', stage: 'preflight' })];
      return { index: result.index, name: result.item.name, errors };
    });
    const now = new Date().toISOString();
    const failedErrors = failures.flatMap((item) => item.errors);
    const limitReached = failedErrors.some((item) => looksLikeBusinessLimit(item.message, item.metaSubcode));
    const lastFailure = failures.at(-1)?.errors.at(-1);
    // Giữ nguyên metaCode/metaSubcode khi phân loại để nhận đúng subcode 1690114.
    const classified = lastFailure
      ? classifyMetaTokenError(new MetaTokenError(lastFailure.message, { code: lastFailure.metaCode, subcode: lastFailure.metaSubcode }))
      : null;
    currentRecord = await updateMetaToken(workspaceOwner, currentRecord, {
      status: limitReached || (failures.length && !successes.length && classified?.status === 'create_restricted') ? 'create_restricted' : 'active',
      metaUserId: context.snapshot.actor.id,
      metaUserName: context.snapshot.actor.name,
      lastUsedAt: now,
      lastCreateAt: now,
      lastCreateResult: `success:${successes.length};failed:${failures.length}${limitReached ? ';limit' : ''}`,
      lastError: lastFailure?.message,
      lastErrorCode: lastFailure?.metaCode,
      lastErrorSubcode: lastFailure?.metaSubcode,
    });
    await audit(workspaceOwner, `Tạo BM ${input.mode}: ${successes.length} thành công, ${failures.length} thất bại${limitReached ? ' (chạm giới hạn Meta)' : ''} · token ${currentRecord.label}`).run();

    const first = successes[0]?.ok ? successes[0].value : undefined;
    const partialPersisted = successes
      .map((result) => result.ok ? result.value : null)
      .filter((value): value is NonNullable<typeof value> => value !== null && !value.persisted);
    return Response.json({
      ok: failures.length === 0,
      limitReached,
      id: first?.id,
      name: first?.name,
      saved: Boolean(first?.persisted),
      partialPersisted: partialPersisted.map((item) => ({ id: item.id, name: item.name, persistError: item.persistError })),
      business: first ? {
        id: first.id,
        name: first.name,
        status: first.asset.status,
        verificationStatus: first.asset.verificationStatus,
        verified: first.asset.verified,
        creationTime: first.asset.creationTime,
        timezoneId: first.asset.timezoneId,
        primaryPage: { id: first.asset.primaryPageId || '', name: first.asset.primaryPageName || '' },
        createdBy: { id: first.asset.createdById || '', name: first.asset.createdByName || '' },
      } : undefined,
      invite: first?.invite,
      mode: input.mode,
      summary: { total: jobs.length, processed: batch.length, success: successes.length, failed: failures.length, skipped: jobs.length - batch.length },
      results: successes.map((result) => result.ok ? result.value : null).filter(Boolean),
      failures,
      tokenStatus: currentRecord.status,
      message: limitReached
        ? `Tạo được ${successes.length} BM rồi chạm giới hạn tạo Business của tài khoản này. Batch đã dừng đúng lúc, không retry thêm.`
        : `Đã xử lý ${batch.length} BM: ${successes.length} thành công, ${failures.length} thất bại.${partialPersisted.length ? ` ${partialPersisted.length} BM đã tạo trên Meta nhưng chưa lưu vào workspace (PARTIAL_SUCCESS) — đừng tạo lại, chạy Đồng bộ token để recovery Business ID.` : ''}`,
    }, { status: successes.length ? 200 : 400 });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'Cấu hình tạo BM không hợp lệ.' }, { status: 400 });
    if (error instanceof MetaCreationError) return Response.json({ error: redactSecrets(error.message), errors: error.errors.map((item) => ({ ...item, message: redactSecrets(item.message) })) }, { status: 400 });
    return Response.json({ error: redactSecrets((error as Error).message) }, { status: 400 });
  }
}
