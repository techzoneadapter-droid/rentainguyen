import { z } from 'zod';
import { audit, list, owner, put } from '../../../lib/server';
import {
  credentialFingerprint,
  encryptCredential,
  looksLikeMetaCookie,
  metaCookieUid,
  normalizeMetaCookie,
} from '../../../lib/credential-vault';

type MetaSessionRecord = {
  id: string;
  label: string;
  uid: string;
  encrypted: string;
  fingerprint: string;
  created: string;
  updated: string;
};

type PublicMetaSession = Omit<MetaSessionRecord, 'encrypted'>;

const importSchema = z.object({
  action: z.literal('import'),
  items: z.array(z.object({
    label: z.string().trim().max(80).optional(),
    uid: z.string().trim().regex(/^\d{5,30}$/).optional(),
    cookie: z.string().trim().min(20).max(16384),
  })).min(1).max(50),
});

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

function publicSession(record: MetaSessionRecord): PublicMetaSession {
  const { encrypted, ...safe } = record;
  void encrypted;
  return safe;
}

async function getSessions(workspaceOwner: string) {
  return await list(workspaceOwner, 'meta-session') as MetaSessionRecord[];
}

export async function GET() {
  try {
    const workspaceOwner = await owner();
    const sessions = await getSessions(workspaceOwner);
    return Response.json({ sessions: sessions.map(publicSession) });
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
    const input = importSchema.parse(await req.json());
    const existing = await getSessions(workspaceOwner);
    const byUid = new Map(existing.map((record) => [record.uid, record] as const));
    const byFingerprint = new Map(existing.map((record) => [record.fingerprint, record] as const));

    let imported = 0;
    let updated = 0;
    const saved: PublicMetaSession[] = [];

    for (const item of input.items) {
      const cookie = normalizeMetaCookie(item.cookie);
      if (!looksLikeMetaCookie(cookie)) {
        throw new Error('Cookie không có cấu trúc session Facebook hợp lệ (cần c_user và ít nhất một cookie phiên như xs/datr/fr/sb).');
      }

      const cookieUid = metaCookieUid(cookie);
      if (item.uid && item.uid !== cookieUid) {
        throw new Error(`UID ${item.uid} không khớp c_user=${cookieUid} trong cookie.`);
      }

      const uid = item.uid || cookieUid;
      const fingerprint = await credentialFingerprint(cookie);
      const current = byUid.get(uid) || byFingerprint.get(fingerprint);
      const now = new Date().toISOString();
      const record: MetaSessionRecord = current
        ? {
            ...current,
            label: item.label || current.label,
            uid,
            encrypted: await encryptCredential(cookie),
            fingerprint,
            updated: now,
          }
        : {
            id: crypto.randomUUID(),
            label: item.label || `Session ${uid}`,
            uid,
            encrypted: await encryptCredential(cookie),
            fingerprint,
            created: now,
            updated: now,
          };

      await put(workspaceOwner, 'meta-session', record).run();
      byUid.set(uid, record);
      byFingerprint.set(fingerprint, record);
      saved.push(publicSession(record));
      if (current) updated += 1;
      else imported += 1;
    }

    await audit(workspaceOwner, `Nạp session cookie: mới ${imported}, cập nhật ${updated}`).run();
    return Response.json({
      imported,
      updated,
      processed: input.items.length,
      sessions: saved,
      message: `Đã mã hóa và lưu ${input.items.length} session cookie (${imported} mới, ${updated} cập nhật).`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Dữ liệu cookie không hợp lệ. Mỗi lượt tối đa 50 session.' }, { status: 400 });
    }
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
