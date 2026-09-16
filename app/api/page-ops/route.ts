import { z } from 'zod';
import { config, owner } from '../../../lib/server';
import {
  classifyMetaTokenError,
  getMetaTokenSecret,
  graphPostWithToken,
  graphWithToken,
  updateMetaToken,
} from '../../../lib/meta-tokens';

type MetaObject = Record<string, unknown>;
type GraphList = MetaObject & { data?: unknown[]; paging?: { cursors?: { after?: string } } };

const querySchema = z.object({
  tokenId: z.string().uuid(),
  pageId: z.string().regex(/^\d{5,30}$/),
});

const createSchema = z.object({
  action: z.literal('publish'),
  tokenId: z.string().uuid(),
  pageId: z.string().regex(/^\d{5,30}$/),
  message: z.string().trim().min(1).max(10000),
});

const deleteSchema = z.object({
  action: z.literal('delete_post'),
  tokenId: z.string().uuid(),
  pageId: z.string().regex(/^\d{5,30}$/),
  postId: z.string().min(5).max(100),
});

const requestSchema = z.union([createSchema, deleteSchema]);

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

async function pageAccessToken(userToken: string, pageId: string) {
  let after = '';
  for (let page = 0; page < 10; page += 1) {
    const response = await graphWithToken(userToken, 'me/accounts', {
      fields: 'id,name,tasks,access_token',
      limit: '100',
      ...(after ? { after } : {}),
    }) as GraphList;
    const rows = Array.isArray(response.data) ? response.data.map(objectValue) : [];
    const matched = rows.find((row) => text(row.id) === pageId);
    if (matched) {
      const token = text(matched.access_token);
      if (!token) throw new Error('Meta không trả Page Access Token cho Page này. Kiểm tra quyền Page của user token.');
      return { token, name: text(matched.name), tasks: Array.isArray(matched.tasks) ? matched.tasks.map(String) : [] };
    }
    const next = text(response.paging?.cursors?.after);
    if (!next || rows.length === 0) break;
    after = next;
  }
  throw new Error('Token không có Page này trong me/accounts.');
}

async function listPosts(token: string, pageId: string) {
  const response = await graphWithToken(token, `${pageId}/posts`, {
    fields: 'id,message,created_time,permalink_url,is_published',
    limit: '30',
  }) as GraphList;
  return (Array.isArray(response.data) ? response.data : []).map(objectValue).map((row) => ({
    id: text(row.id),
    message: text(row.message),
    createdTime: text(row.created_time),
    permalinkUrl: text(row.permalink_url),
    isPublished: Boolean(row.is_published),
  })).filter((row) => row.id);
}

async function deleteObject(token: string, objectId: string) {
  const url = new URL(`https://graph.facebook.com/${config().version}/${objectId}`);
  url.searchParams.set('access_token', token);
  const response = await fetch(url, {
    method: 'DELETE',
    signal: AbortSignal.timeout(25000),
  });
  const body = await response.json() as MetaObject;
  if (!response.ok || body.error) {
    const error = objectValue(body.error);
    throw new Error(text(error.message) || `Meta HTTP ${response.status}`);
  }
  return body;
}

export async function GET(req: Request) {
  try {
    const workspaceOwner = await owner();
    const url = new URL(req.url);
    const input = querySchema.parse({
      tokenId: url.searchParams.get('tokenId') || '',
      pageId: url.searchParams.get('pageId') || '',
    });
    const source = await getMetaTokenSecret(workspaceOwner, input.tokenId);
    const page = await pageAccessToken(source.token, input.pageId);
    const [details, posts] = await Promise.all([
      graphWithToken(page.token, input.pageId, { fields: 'id,name,link,fan_count,followers_count,verification_status' }) as Promise<MetaObject>,
      listPosts(page.token, input.pageId),
    ]);
    await updateMetaToken(workspaceOwner, source.record, {
      status: 'active', lastUsedAt: new Date().toISOString(), lastCheckedAt: new Date().toISOString(),
      lastError: undefined, lastErrorCode: undefined, lastErrorSubcode: undefined,
    });
    return Response.json({
      page: {
        id: text(details.id), name: text(details.name) || page.name, link: text(details.link),
        fanCount: Number(details.fan_count || 0), followersCount: Number(details.followers_count || 0),
        verificationStatus: text(details.verification_status), tasks: page.tasks,
      },
      posts,
    });
  } catch (error) {
    const classified = classifyMetaTokenError(error);
    return Response.json({ error: classified.reason }, { status: 400 });
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
  try {
    const workspaceOwner = await owner();
    const input = requestSchema.parse(await req.json());
    const source = await getMetaTokenSecret(workspaceOwner, input.tokenId);
    const page = await pageAccessToken(source.token, input.pageId);
    if (input.action === 'publish') {
      const result = await graphPostWithToken(page.token, `${input.pageId}/feed`, { message: input.message });
      await updateMetaToken(workspaceOwner, source.record, { status: 'active', lastUsedAt: new Date().toISOString(), lastError: undefined });
      return Response.json({ ok: true, id: text(result.id), message: 'Đã đăng bài lên Page.' });
    }
    if (!input.postId.startsWith(`${input.pageId}_`)) {
      return Response.json({ error: 'Bài viết không thuộc Page đã chọn.' }, { status: 400 });
    }
    await deleteObject(page.token, input.postId);
    await updateMetaToken(workspaceOwner, source.record, { status: 'active', lastUsedAt: new Date().toISOString(), lastError: undefined });
    return Response.json({ ok: true, message: 'Đã xóa bài viết khỏi Page.' });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'Dữ liệu thao tác Page không hợp lệ.' }, { status: 400 });
    const classified = classifyMetaTokenError(error);
    return Response.json({ error: classified.reason }, { status: 400 });
  }
}
