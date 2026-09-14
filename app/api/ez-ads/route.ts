import { z } from 'zod';
import { owner } from '../../../lib/server';
import {
  classifyMetaTokenError,
  getMetaTokenSecret,
  graphPostWithToken,
  graphWithToken,
  updateMetaToken,
} from '../../../lib/meta-tokens';

const querySchema = z.object({
  tokenId: z.string().uuid(),
  accountId: z.string().regex(/^\d{5,30}$/),
});

const mutationSchema = z.object({
  tokenId: z.string().uuid(),
  accountId: z.string().regex(/^\d{5,30}$/),
  campaignId: z.string().regex(/^\d{5,30}$/),
  status: z.enum(['ACTIVE', 'PAUSED']),
});

type MetaObject = Record<string, unknown>;
type GraphList = MetaObject & {
  data?: unknown[];
  paging?: { cursors?: { after?: string } };
};

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

function objectValue(value: unknown): MetaObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as MetaObject : {};
}

function text(value: unknown) {
  return value === undefined || value === null ? '' : String(value).trim();
}

async function listCampaigns(token: string, accountId: string) {
  const rows: MetaObject[] = [];
  let after = '';

  for (let page = 0; page < 10; page += 1) {
    const response = await graphWithToken(token, `act_${accountId}/campaigns`, {
      fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time,updated_time',
      limit: '100',
      ...(after ? { after } : {}),
    }) as GraphList;

    const pageRows = Array.isArray(response.data) ? response.data.map(objectValue) : [];
    rows.push(...pageRows);
    const next = text(response.paging?.cursors?.after);
    if (!next || pageRows.length === 0) break;
    after = next;
  }

  return rows.map((row) => ({
    id: text(row.id),
    name: text(row.name) || `Campaign ${text(row.id)}`,
    status: text(row.status),
    effectiveStatus: text(row.effective_status),
    objective: text(row.objective),
    dailyBudget: text(row.daily_budget),
    lifetimeBudget: text(row.lifetime_budget),
    createdTime: text(row.created_time),
    updatedTime: text(row.updated_time),
  })).filter((row) => /^\d{5,30}$/.test(row.id));
}

export async function GET(req: Request) {
  try {
    const workspaceOwner = await owner();
    const url = new URL(req.url);
    const input = querySchema.parse({
      tokenId: url.searchParams.get('tokenId') || '',
      accountId: (url.searchParams.get('accountId') || '').replace(/^act_/, ''),
    });

    const source = await getMetaTokenSecret(workspaceOwner, input.tokenId);
    const now = new Date().toISOString();

    try {
      const campaigns = await listCampaigns(source.token, input.accountId);
      await updateMetaToken(workspaceOwner, source.record, {
        status: 'active',
        lastCheckedAt: now,
        lastUsedAt: now,
        lastError: undefined,
        lastErrorCode: undefined,
        lastErrorSubcode: undefined,
      });
      return Response.json({ campaigns, accountId: input.accountId, tokenLabel: source.record.label });
    } catch (error) {
      const classified = classifyMetaTokenError(error);
      await updateMetaToken(workspaceOwner, source.record, {
        status: classified.status === 'unknown_error' ? source.record.status : classified.status,
        lastCheckedAt: now,
        lastUsedAt: now,
        lastError: classified.reason,
        lastErrorCode: classified.code,
        lastErrorSubcode: classified.subcode,
      });
      return Response.json({ error: classified.reason, tokenStatus: classified.status }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Token hoặc ID tài khoản quảng cáo không hợp lệ.' }, { status: 400 });
    }
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
  }

  try {
    const workspaceOwner = await owner();
    const input = mutationSchema.parse(await req.json());
    const source = await getMetaTokenSecret(workspaceOwner, input.tokenId);
    const now = new Date().toISOString();

    try {
      const campaign = await graphWithToken(source.token, input.campaignId, {
        fields: 'id,name,account_id,status',
      }) as MetaObject;
      const campaignAccountId = text(campaign.account_id).replace(/^act_/, '');
      if (campaignAccountId !== input.accountId) {
        return Response.json({ error: 'Campaign không thuộc TKQC đã chọn.' }, { status: 400 });
      }

      await graphPostWithToken(source.token, input.campaignId, { status: input.status });
      await updateMetaToken(workspaceOwner, source.record, {
        status: 'active',
        lastCheckedAt: now,
        lastUsedAt: now,
        lastError: undefined,
        lastErrorCode: undefined,
        lastErrorSubcode: undefined,
      });

      return Response.json({
        ok: true,
        campaignId: input.campaignId,
        status: input.status,
        message: `Đã ${input.status === 'ACTIVE' ? 'bật' : 'tạm dừng'} campaign ${text(campaign.name) || input.campaignId}.`,
      });
    } catch (error) {
      const classified = classifyMetaTokenError(error);
      await updateMetaToken(workspaceOwner, source.record, {
        status: classified.status === 'unknown_error' ? source.record.status : classified.status,
        lastCheckedAt: now,
        lastUsedAt: now,
        lastError: classified.reason,
        lastErrorCode: classified.code,
        lastErrorSubcode: classified.subcode,
      });
      return Response.json({ error: classified.reason, tokenStatus: classified.status }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Token, TKQC, campaign hoặc trạng thái không hợp lệ.' }, { status: 400 });
    }
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
