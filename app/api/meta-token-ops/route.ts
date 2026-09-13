import { z } from 'zod';
import { audit, owner } from '../../../lib/server';
import {
  classifyMetaTokenError,
  getMetaTokenSecret,
  graphPostWithToken,
  graphWithToken,
  updateMetaToken,
} from '../../../lib/meta-tokens';

type MetaObject = Record<string, unknown>;
type GraphListResponse = MetaObject & {
  data?: unknown[];
  paging?: { cursors?: { after?: string } };
};

const inviteSchema = z.object({
  action: z.literal('invite_business_user'),
  tokenId: z.string().uuid(),
  businessId: z.string().regex(/^\d{5,30}$/),
  email: z.string().email().max(254),
  role: z.enum(['ADMIN', 'EMPLOYEE']),
  purposeConfirmed: z.literal(true),
});

const billingSchema = z.object({
  action: z.literal('read_billing'),
  tokenId: z.string().uuid(),
  adAccountId: z.string().regex(/^\d{5,30}$/),
});

const requestSchema = z.union([inviteSchema, billingSchema]);

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
  for (let page = 0; page < 10; page += 1) {
    const response = await graphWithToken(token, path, {
      fields,
      limit: '100',
      ...(after ? { after } : {}),
    }) as GraphListResponse;
    const pageRows = Array.isArray(response.data) ? response.data.map(objectValue) : [];
    rows.push(...pageRows);
    const next = text(response.paging?.cursors?.after);
    if (!next || pageRows.length === 0) break;
    after = next;
  }
  return rows;
}

async function assertBusinessAccess(token: string, businessId: string) {
  const businesses = await graphListWithToken(token, 'me/businesses', 'id,name,verification_status');
  const business = businesses.find((item) => text(item.id) === businessId);
  if (!business) throw new Error('Token không có Business Manager này trong danh sách được phép truy cập.');
  return business;
}

async function assertAdAccountAccess(token: string, adAccountId: string) {
  const accounts = await graphListWithToken(token, 'me/adaccounts', 'id,name,account_status');
  const account = accounts.find((item) => text(item.id).replace(/^act_/, '') === adAccountId);
  if (!account) throw new Error('Token không có tài khoản quảng cáo này trong danh sách được phép truy cập.');
  return account;
}

export async function GET(req: Request) {
  try {
    const workspaceOwner = await owner();
    const tokenId = new URL(req.url).searchParams.get('tokenId') || '';
    if (!/^[0-9a-f-]{36}$/i.test(tokenId)) {
      return Response.json({ error: 'Token nguồn không hợp lệ.' }, { status: 400 });
    }
    const source = await getMetaTokenSecret(workspaceOwner, tokenId);
    const [businesses, adAccounts] = await Promise.all([
      graphListWithToken(source.token, 'me/businesses', 'id,name,verification_status'),
      graphListWithToken(source.token, 'me/adaccounts', 'id,name,account_status,currency,spend_cap'),
    ]);
    return Response.json({
      businesses: businesses.map((item) => ({
        id: text(item.id),
        name: text(item.name),
        verificationStatus: text(item.verification_status) || 'unknown',
      })),
      adAccounts: adAccounts.map((item) => ({
        id: text(item.id).replace(/^act_/, ''),
        name: text(item.name),
        accountStatus: Number(item.account_status || 0),
        currency: text(item.currency),
        spendCap: text(item.spend_cap),
      })),
    });
  } catch (error) {
    const classified = classifyMetaTokenError(error);
    return Response.json({ error: classified.reason }, { status: 400 });
  }
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

    if (input.action === 'invite_business_user') {
      const business = await assertBusinessAccess(source.token, input.businessId);
      await graphPostWithToken(source.token, `${input.businessId}/business_users`, {
        email: input.email,
        role: input.role,
      });
      await updateMetaToken(workspaceOwner, source.record, {
        status: 'active',
        lastUsedAt: now,
        lastError: undefined,
        lastErrorCode: undefined,
        lastErrorSubcode: undefined,
      });
      await audit(workspaceOwner, `Mời ${input.role} vào BM ${text(business.name) || input.businessId}`).run();
      return Response.json({
        ok: true,
        message: `Đã gửi lời mời ${input.role === 'ADMIN' ? 'quản trị viên' : 'nhân viên'} tới email đã nhập. Người nhận phải tự chấp nhận lời mời của Meta.`,
      });
    }

    await assertAdAccountAccess(source.token, input.adAccountId);
    const account = await graphWithToken(source.token, `act_${input.adAccountId}`, {
      fields: 'id,name,account_status,disable_reason,currency,balance,amount_spent,spend_cap,funding_source,funding_source_details',
    }) as MetaObject;
    await updateMetaToken(workspaceOwner, source.record, {
      status: 'active',
      lastUsedAt: now,
      lastError: undefined,
      lastErrorCode: undefined,
      lastErrorSubcode: undefined,
    });
    const funding = objectValue(account.funding_source_details);
    return Response.json({
      billing: {
        id: text(account.id).replace(/^act_/, ''),
        name: text(account.name),
        accountStatus: Number(account.account_status || 0),
        disableReason: Number(account.disable_reason || 0),
        currency: text(account.currency),
        balance: text(account.balance),
        amountSpent: text(account.amount_spent),
        spendCap: text(account.spend_cap),
        hasFundingSource: Boolean(text(account.funding_source)),
        fundingType: text(funding.type),
        fundingDisplay: text(funding.display_string),
      },
      message: 'Đã đọc trạng thái thanh toán. App không thu thập hoặc lưu số thẻ, CVV hay dữ liệu thẻ thanh toán.',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Dữ liệu thao tác token không hợp lệ.' }, { status: 400 });
    }
    const classified = classifyMetaTokenError(error);
    return Response.json({ error: classified.reason }, { status: 400 });
  }
}
