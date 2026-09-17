import { z } from 'zod';
import { inspectAccount } from '../../../lib/account-inspect';
import {
  credentialFingerprint,
  decryptCredential,
  encryptCredential,
  looksLikeMetaCookie,
  metaCookieUid,
  normalizeMetaCookie,
  type MetaSessionRecord,
} from '../../../lib/credential-vault';
import { mapPool } from '../../../lib/resource-model';
import { audit, list, owner, put } from '../../../lib/server';

type PublicMetaSession = Omit<MetaSessionRecord, 'encrypted'>;

const importSchema = z.object({
  action: z.literal('import'),
  items: z.array(z.object({
    label: z.string().trim().max(80).optional(),
    uid: z.string().trim().regex(/^\d{5,30}$/).optional(),
    cookie: z.string().trim().min(20).max(16384),
  })).min(1).max(50),
});

const checkSchema = z.object({
  action: z.literal('check'),
  ids: z.array(z.string().uuid()).max(50).optional(),
});

const requestSchema = z.discriminatedUnion('action', [importSchema, checkSchema]);

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
    const input = requestSchema.parse(await req.json());
    const existing = await getSessions(workspaceOwner);

    if (input.action === 'check') {
      const targets = input.ids?.length
        ? existing.filter((record) => input.ids?.includes(record.id))
        : existing.slice(0, 50);
      let live = 0;
      // Mỗi session là một dòng dữ liệu riêng nên có thể check song song có giới hạn.
      const checked = await mapPool(targets, 4, async (record) => {
        const cookie = await decryptCredential(record.encrypted);
        const now = new Date().toISOString();
        try {
          const inspection = await inspectAccount({ cookie });
          const next: MetaSessionRecord = {
            ...record,
            status: 'active',
            metaUserName: inspection.me.name,
            lastCheckedAt: now,
            lastError: inspection.warnings.slice(0, 2).join(' | ') || undefined,
            businessCount: inspection.businesses.length,
            pageCount: inspection.pages.length,
            adAccountCount: inspection.adAccounts.length,
            updated: now,
          };
          await put(workspaceOwner, 'meta-session', next).run();
          live += 1;
          return publicSession(next);
        } catch (error) {
          const next: MetaSessionRecord = {
            ...record,
            status: 'invalid',
            lastCheckedAt: now,
            lastError: (error as Error).message,
            updated: now,
          };
          await put(workspaceOwner, 'meta-session', next).run();
          return publicSession(next);
        }
      });
      await audit(workspaceOwner, `Check session cookie: ${checked.length} phiên, LIVE ${live}`).run();
      return Response.json({
        processed: checked.length,
        live,
        sessions: checked,
        message: `Đã check ${checked.length} session cookie · LIVE ${live}.`,
      });
    }

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
