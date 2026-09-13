import { z } from 'zod';
import type { Asset } from '../../../lib/data';
import { audit, db, list, owner, put } from '../../../lib/server';
import {
  classifyMetaTokenError,
  getMetaTokenSecret,
  graphWithToken,
  updateMetaToken,
} from '../../../lib/meta-tokens';

const requestSchema = z.object({
  action: z.literal('import_token'),
  tokenId: z.string().uuid(),
});

type MetaObject = Record<string, unknown>;
type GraphListResponse = MetaObject & {
  data?: unknown[];
  paging?: { cursors?: { after?: string } };
};

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

function text(value: unknown) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function objectValue(value: unknown): MetaObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as MetaObject : {};
}

async function graphListWithToken(token: string, path: string, fields: string) {
  const rows: MetaObject[] = [];
  let after = '';

  for (let page = 0; page < 20; page += 1) {
    const response = await graphWithToken(token, path, {
      fields,
      limit: '100',
      ...(after ? { after } : {}),
    }) as GraphListResponse;
    const pageRows = Array.isArray(response.data)
      ? response.data.map(objectValue)
      : [];
    rows.push(...pageRows);
    const nextAfter = text(response.paging?.cursors?.after);
    if (!nextAfter || pageRows.length === 0) break;
    after = nextAfter;
  }

  return rows;
}

function assetId(workspaceOwner: string, metaId: string) {
  return `${workspaceOwner}:meta:${metaId}`;
}

function adAccountStatus(value: unknown) {
  const status = Number(value || 0);
  if (status === 1) return 'LIVE';
  if ([2, 101].includes(status)) return 'DIE';
  return 'Hạn chế';
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
  }

  try {
    const workspaceOwner = await owner();
    const input = requestSchema.parse(await req.json());
    const source = await getMetaTokenSecret(workspaceOwner, input.tokenId);
    const now = new Date().toISOString();

    let me: MetaObject;
    let businesses: MetaObject[];
    try {
      me = await graphWithToken(source.token, 'me', { fields: 'id,name' });
      businesses = await graphListWithToken(
        source.token,
        'me/businesses',
        'id,name,verification_status,creation_time,timezone_id,primary_page',
      );
    } catch (error) {
      const classified = classifyMetaTokenError(error);
      await updateMetaToken(workspaceOwner, source.record, {
        status: classified.status,
        lastCheckedAt: now,
        lastUsedAt: now,
        lastError: classified.reason,
        lastErrorCode: classified.code,
        lastErrorSubcode: classified.subcode,
      });
      return Response.json({ error: classified.reason }, { status: 400 });
    }

    const metaUserId = text(me.id);
    const metaUserName = text(me.name);
    const existing = await list(workspaceOwner, 'asset') as Asset[];
    const existingById = new Map(existing.map((asset) => [asset.id, asset] as const));
    const imported: Asset[] = [];

    for (const business of businesses) {
      const businessId = text(business.id);
      if (!/^\d{5,30}$/.test(businessId)) continue;
      const primaryPage = objectValue(business.primary_page);
      const businessRecordId = assetId(workspaceOwner, businessId);
      const currentBusiness = existingById.get(businessRecordId);
      const verificationStatus = text(business.verification_status) || 'unknown';

      imported.push({
        ...currentBusiness,
        id: businessRecordId,
        metaId: businessId,
        name: text(business.name) || currentBusiness?.name || `Business ${businessId}`,
        type: 'BM',
        status: 'Truy cập được',
        verified: verificationStatus.toLowerCase() === 'verified',
        verificationStatus,
        country: currentBusiness?.country || 'Chưa rõ',
        tier: currentBusiness?.tier || 'Chưa rõ',
        limit: currentBusiness?.limit || 'Chưa rõ',
        parent: '',
        source: 'meta',
        checked: now,
        creationTime: text(business.creation_time) || currentBusiness?.creationTime,
        timezoneId: text(business.timezone_id) || currentBusiness?.timezoneId,
        primaryPageId: text(primaryPage.id) || currentBusiness?.primaryPageId,
        primaryPageName: text(primaryPage.name) || currentBusiness?.primaryPageName,
        createdById: metaUserId || currentBusiness?.createdById,
        createdByName: metaUserName || currentBusiness?.createdByName,
        healthNote: `Đã nhập từ token ${source.record.label}.`,
      });

      const [accounts, pages, pixels] = await Promise.all([
        graphListWithToken(source.token, `${businessId}/owned_ad_accounts`, 'id,name,account_status,spend_cap,currency'),
        graphListWithToken(source.token, `${businessId}/owned_pages`, 'id,name'),
        graphListWithToken(source.token, `${businessId}/adspixels`, 'id,name'),
      ]);

      for (const account of accounts) {
        const rawId = text(account.id);
        const accountId = rawId.replace(/^act_/, '');
        if (!/^\d{5,30}$/.test(accountId)) continue;
        const recordId = assetId(workspaceOwner, accountId);
        const current = existingById.get(recordId);
        const currency = text(account.currency) || current?.currency || '';
        const spendCap = text(account.spend_cap);
        imported.push({
          ...current,
          id: recordId,
          metaId: accountId,
          name: text(account.name) || current?.name || `Ads ${accountId}`,
          type: 'TKQC',
          status: adAccountStatus(account.account_status),
          verified: false,
          country: current?.country || 'Chưa rõ',
          tier: current?.tier || '—',
          limit: spendCap && spendCap !== '0' ? `${spendCap} ${currency} (đơn vị API)` : current?.limit || 'Chưa thiết lập',
          parent: businessRecordId,
          source: 'meta',
          checked: now,
          currency,
          metaStatus: Number(account.account_status || 0),
          createdById: metaUserId || current?.createdById,
          createdByName: metaUserName || current?.createdByName,
          healthNote: `Đã nhập từ token ${source.record.label}.`,
        });
      }

      for (const [rows, type] of [[pages, 'Page'], [pixels, 'Dataset/Pixel']] as const) {
        for (const item of rows) {
          const metaId = text(item.id);
          if (!/^\d{5,30}$/.test(metaId)) continue;
          const recordId = assetId(workspaceOwner, metaId);
          const current = existingById.get(recordId);
          imported.push({
            ...current,
            id: recordId,
            metaId,
            name: text(item.name) || current?.name || `${type} ${metaId}`,
            type,
            status: 'Truy cập được',
            verified: false,
            country: current?.country || 'Chưa rõ',
            tier: current?.tier || '—',
            limit: current?.limit || '—',
            parent: businessRecordId,
            source: 'meta',
            checked: now,
            createdById: metaUserId || current?.createdById,
            createdByName: metaUserName || current?.createdByName,
            healthNote: `Đã nhập từ token ${source.record.label}.`,
          });
        }
      }
    }

    const unique = Array.from(new Map(imported.map((asset) => [asset.id, asset] as const)).values());
    const statements = unique.map((asset) => put(workspaceOwner, 'asset', asset));
    for (let index = 0; index < statements.length; index += 50) {
      await db().batch(statements.slice(index, index + 50));
    }

    await updateMetaToken(workspaceOwner, source.record, {
      status: 'active',
      metaUserId: metaUserId || source.record.metaUserId,
      metaUserName: metaUserName || source.record.metaUserName,
      lastCheckedAt: now,
      lastUsedAt: now,
      lastError: undefined,
      lastErrorCode: undefined,
      lastErrorSubcode: undefined,
    });
    await audit(workspaceOwner, `Nhập ${unique.length} tài nguyên từ token ${source.record.label}`).run();

    return Response.json({
      ok: true,
      imported: unique.length,
      businesses: unique.filter((asset) => asset.type === 'BM').length,
      adAccounts: unique.filter((asset) => asset.type === 'TKQC').length,
      pages: unique.filter((asset) => asset.type === 'Page').length,
      pixels: unique.filter((asset) => asset.type === 'Dataset/Pixel').length,
      message: `Đã nhập ${unique.length} tài nguyên có thể truy cập bằng token ${source.record.label}.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Token nguồn không hợp lệ.' }, { status: 400 });
    }
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
