import { z } from 'zod';
import { audit, db, owner, put } from '../../../lib/server';
import {
  classifyMetaTokenError,
  encryptToken,
  getMetaTokenRecord,
  getMetaTokenSecret,
  getMetaTokens,
  graphWithToken,
  publicToken,
  tokenFingerprint,
  updateMetaToken,
  type MetaTokenRecord,
} from '../../../lib/meta-tokens';

const addSchema = z.object({
  action: z.literal('add'),
  label: z.string().trim().min(1).max(80),
  token: z.string().trim().min(20).max(4096),
});

const idSchema = z.object({
  action: z.enum(['check', 'delete']),
  id: z.string().uuid(),
});

const requestSchema = z.union([addSchema, idSchema]);

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

export async function GET() {
  try {
    const user = await owner();
    const tokens = (await getMetaTokens(user)).map(publicToken);
    return Response.json({ tokens });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
  }

  try {
    const user = await owner();
    const input = requestSchema.parse(await req.json());

    if (input.action === 'add') {
      let me: Record<string, unknown>;
      try {
        me = await graphWithToken(input.token, 'me', { fields: 'id,name' });
      } catch (error) {
        const classified = classifyMetaTokenError(error);
        return Response.json(
          {
            error: `Không lưu token vì Meta chưa xác nhận token hoạt động: ${classified.reason}`,
            tokenStatus: classified.status,
          },
          { status: 400 },
        );
      }

      const now = new Date().toISOString();
      const record: MetaTokenRecord = {
        id: crypto.randomUUID(),
        label: input.label,
        encrypted: await encryptToken(input.token),
        fingerprint: await tokenFingerprint(input.token),
        status: 'active',
        created: now,
        updated: now,
        metaUserId: String(me.id || ''),
        metaUserName: String(me.name || ''),
        lastCheckedAt: now,
      };

      await db().batch([
        put(user, 'meta-token', record),
        audit(user, `Thêm token nguồn: ${record.label}`),
      ]);
      return Response.json({ token: publicToken(record), message: 'Đã lưu token nguồn an toàn.' });
    }

    if (input.action === 'delete') {
      const record = await getMetaTokenRecord(user, input.id);
      await db().batch([
        db().prepare('DELETE FROM records WHERE owner = ? AND kind = ? AND id = ?').bind(user, 'meta-token', record.id),
        audit(user, `Xóa token nguồn: ${record.label}`),
      ]);
      return Response.json({ message: 'Đã xóa token khỏi kho.' });
    }

    const { record, token } = await getMetaTokenSecret(user, input.id);
    try {
      const me = await graphWithToken(token, 'me', { fields: 'id,name' });
      const updated = await updateMetaToken(user, record, {
        status: 'active',
        metaUserId: String(me.id || ''),
        metaUserName: String(me.name || ''),
        lastCheckedAt: new Date().toISOString(),
        lastError: undefined,
        lastErrorCode: undefined,
        lastErrorSubcode: undefined,
      });
      return Response.json({ token: publicToken(updated), message: 'Token đang hoạt động.' });
    } catch (error) {
      const classified = classifyMetaTokenError(error);
      const updated = await updateMetaToken(user, record, {
        status: classified.status,
        lastCheckedAt: new Date().toISOString(),
        lastError: classified.reason,
        lastErrorCode: classified.code,
        lastErrorSubcode: classified.subcode,
      });
      return Response.json(
        { token: publicToken(updated), error: classified.reason, tokenStatus: classified.status },
        { status: 400 },
      );
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Dữ liệu quản lý token không hợp lệ.' }, { status: 400 });
    }
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
