import { z } from 'zod';
import type { Asset } from '../../../lib/data';
import { config, list, owner, put } from '../../../lib/server';
import {
  classifyMetaTokenError,
  getMetaTokenSecret,
  graphPostWithToken,
  graphWithToken,
  updateMetaToken,
} from '../../../lib/meta-tokens';

type MetaObject = Record<string, unknown>;
type GraphList = MetaObject & { data?: unknown[]; paging?: { cursors?: { after?: string } } };

const requestSchema = z.object({
  tokenId: z.string().uuid(),
  assetId: z.string().min(1),
  action: z.string().min(1).max(80),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
});

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

function metaId(asset: Asset) {
  if (asset.metaId && /^\d{5,30}$/.test(asset.metaId)) return asset.metaId;
  return asset.id.match(/(\d{5,30})$/)?.[1] || '';
}

function officialUrl(asset: Asset) {
  const id = metaId(asset);
  if (asset.type === 'BM') return `https://business.facebook.com/settings/?business_id=${id}`;
  if (asset.type === 'TKQC') return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${id}`;
  if (asset.type === 'Page') return `https://www.facebook.com/${id}`;
  return 'https://business.facebook.com/';
}

async function findAsset(workspaceOwner: string, id: string) {
  const assets = await list(workspaceOwner, 'asset') as Asset[];
  const asset = assets.find((item) => item.id === id);
  if (!asset) throw new Error('Không tìm thấy tài nguyên trong workspace. Hãy đồng bộ token lại trước.');
  return asset;
}

async function getPageToken(userToken: string, pageId: string) {
  let after = '';
  for (let page = 0; page < 10; page += 1) {
    const response = await graphWithToken(userToken, 'me/accounts', {
      fields: 'id,name,access_token,tasks',
      limit: '100',
      ...(after ? { after } : {}),
    }) as GraphList;
    const rows = Array.isArray(response.data) ? response.data.map(objectValue) : [];
    const matched = rows.find((row) => text(row.id) === pageId);
    if (matched) {
      const token = text(matched.access_token);
      if (!token) throw new Error('Meta không trả Page access token cho Page này.');
      return token;
    }
    const next = text(response.paging?.cursors?.after);
    if (!next || rows.length === 0) break;
    after = next;
  }
  throw new Error('Token nguồn không có Page này trong me/accounts.');
}

function unsupported(message: string) {
  return Response.json({ ok: false, unsupported: true, message });
}

function requiredPayload(payload: Record<string, unknown>, key: string) {
  const value = text(payload[key]);
  if (!value) throw new Error(`Thiếu dữ liệu ${key}.`);
  return value;
}

async function refreshAsset(workspaceOwner: string, asset: Asset, token: string) {
  const id = metaId(asset);
  const now = new Date().toISOString();
  let details: MetaObject = {};
  if (asset.type === 'BM') details = await graphWithToken(token, id, { fields: 'id,name,verification_status,timezone_id,primary_page,created_time' }) as MetaObject;
  if (asset.type === 'TKQC') details = await graphWithToken(token, `act_${id}`, { fields: 'id,name,account_status,disable_reason,currency,spend_cap,balance,amount_spent,funding_source_details' }) as MetaObject;
  if (asset.type === 'Page') {
    const pageToken = await getPageToken(token, id);
    details = await graphWithToken(pageToken, id, { fields: 'id,name,link,fan_count,followers_count,verification_status,is_published' }) as MetaObject;
  }
  await put(workspaceOwner, 'asset', {
    ...asset,
    name: text(details.name) || asset.name,
    status: asset.type === 'TKQC' ? (Number(details.account_status || 0) === 1 ? 'LIVE' : 'Hạn chế') : 'Truy cập được',
    checked: now,
    currency: text(details.currency) || asset.currency,
    limit: text(details.spend_cap) || asset.limit,
    verificationStatus: text(details.verification_status) || asset.verificationStatus,
    healthNote: 'Đã refresh bằng token nguồn.',
  }).run();
  return details;
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
  try {
    const workspaceOwner = await owner();
    const input = requestSchema.parse(await req.json());
    const asset = await findAsset(workspaceOwner, input.assetId);
    const id = metaId(asset);
    if (!id) throw new Error('Tài nguyên không có Meta ID hợp lệ.');
    const source = await getMetaTokenSecret(workspaceOwner, input.tokenId);
    const token = source.token;
    const payload = input.payload;
    let result: MetaObject | null = null;
    let message = 'Đã chạy thao tác.';
    let url = '';

    if (input.action === 'open_official') {
      return Response.json({ ok: true, url: officialUrl(asset), message: 'Đã tạo link mở trang chính thức.' });
    }

    if (input.action === 'refresh') {
      result = await refreshAsset(workspaceOwner, asset, token);
      message = 'Đã check/refresh tài nguyên bằng token nguồn.';
    } else if (asset.type === 'TKQC' && input.action === 'rename_ad_account') {
      const name = requiredPayload(payload, 'name');
      result = await graphPostWithToken(token, `act_${id}`, { name }) as MetaObject;
      await put(workspaceOwner, 'asset', { ...asset, name, checked: new Date().toISOString(), healthNote: 'Đã đổi tên TKQC.' }).run();
      message = 'Đã gửi yêu cầu đổi tên tài khoản quảng cáo.';
    } else if (asset.type === 'TKQC' && input.action === 'set_spend_cap') {
      const spendCap = requiredPayload(payload, 'spendCap');
      if (!/^\d+$/.test(spendCap)) throw new Error('Spend cap phải là số nguyên theo đơn vị API của Meta.');
      result = await graphPostWithToken(token, `act_${id}`, { spend_cap: spendCap }) as MetaObject;
      await put(workspaceOwner, 'asset', { ...asset, limit: spendCap, checked: new Date().toISOString(), healthNote: 'Đã cập nhật giới hạn chi tiêu.' }).run();
      message = 'Đã gửi yêu cầu cập nhật giới hạn chi tiêu.';
    } else if (asset.type === 'BM' && input.action === 'rename_business') {
      const name = requiredPayload(payload, 'name');
      result = await graphPostWithToken(token, id, { name }) as MetaObject;
      await put(workspaceOwner, 'asset', { ...asset, name, checked: new Date().toISOString(), healthNote: 'Đã đổi tên BM.' }).run();
      message = 'Đã gửi yêu cầu đổi thông tin BM.';
    } else if (asset.type === 'Page' && input.action === 'publish_state') {
      const state = requiredPayload(payload, 'state');
      if (!['true', 'false'].includes(state)) throw new Error('state phải là true hoặc false.');
      const pageToken = await getPageToken(token, id);
      result = await graphPostWithToken(pageToken, id, { is_published: state }) as MetaObject;
      await put(workspaceOwner, 'asset', { ...asset, checked: new Date().toISOString(), status: state === 'true' ? 'Truy cập được' : 'Đã hủy đăng', healthNote: state === 'true' ? 'Đã bật lại Page.' : 'Đã hủy đăng Page.' }).run();
      message = state === 'true' ? 'Đã gửi yêu cầu kích hoạt lại Page.' : 'Đã gửi yêu cầu hủy đăng Page.';
    } else if (asset.type === 'Page' && input.action === 'update_page_info') {
      const pageToken = await getPageToken(token, id);
      const params: Record<string, string> = {};
      for (const key of ['about', 'description', 'website', 'phone']) {
        const value = text(payload[key]);
        if (value) params[key] = value;
      }
      if (!Object.keys(params).length) throw new Error('Nhập ít nhất một trường about/description/website/phone.');
      result = await graphPostWithToken(pageToken, id, params) as MetaObject;
      await put(workspaceOwner, 'asset', { ...asset, checked: new Date().toISOString(), healthNote: 'Đã cập nhật thông tin Page.' }).run();
      message = 'Đã gửi yêu cầu đổi thông tin Page.';
    } else if (asset.type === 'BM' && input.action === 'claim_page') {
      const pageId = requiredPayload(payload, 'pageId');
      result = await graphPostWithToken(token, `${id}/owned_pages`, { page_id: pageId }) as MetaObject;
      message = 'Đã gửi yêu cầu thêm Page vào BM.';
    } else if (asset.type === 'BM' && input.action === 'create_system_user') {
      const name = requiredPayload(payload, 'name');
      const role = text(payload.role) || 'EMPLOYEE';
      if (!['ADMIN', 'EMPLOYEE'].includes(role)) throw new Error('Role phải là ADMIN hoặc EMPLOYEE.');
      result = await graphPostWithToken(token, `${id}/system_users`, { name, role }) as MetaObject;
      message = 'Đã tạo System User nếu BM/token đủ quyền.';
    } else if (input.action === 'unsupported') {
      const title = text(payload.title) || 'Chức năng này';
      return unsupported(`${title} không có luồng token-only công khai ổn định trong app hiện tại. App không dùng cookie, DTSG, private endpoint, số thẻ/CVV hoặc luồng vượt giới hạn; hãy dùng link Meta chính thức hoặc bổ sung endpoint hợp lệ trước khi bật chạy thật.`);
    } else {
      return unsupported('Chức năng này chưa có endpoint token-only hợp lệ trong app.');
    }

    await updateMetaToken(workspaceOwner, source.record, { status: 'active', lastUsedAt: new Date().toISOString(), lastError: undefined });
    if (!url) url = officialUrl(asset);
    return Response.json({ ok: true, message, result, url });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'Dữ liệu thao tác không hợp lệ.' }, { status: 400 });
    const classified = classifyMetaTokenError(error);
    return Response.json({ error: classified.reason }, { status: 400 });
  }
}
