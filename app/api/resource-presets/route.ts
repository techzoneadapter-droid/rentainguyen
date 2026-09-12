import { z } from 'zod';
import { audit, db, list, owner, put } from '../../../lib/server';
import { getMetaTokenRecord } from '../../../lib/meta-tokens';

const verticals = [
  'ADVERTISING', 'AUTOMOTIVE', 'CONSUMER_PACKAGED_GOODS', 'ECOMMERCE', 'EDUCATION',
  'ENERGY_AND_UTILITIES', 'ENTERTAINMENT_AND_MEDIA', 'FINANCIAL_SERVICES', 'GAMING',
  'GOVERNMENT_AND_POLITICS', 'MARKETING', 'ORGANIZATIONS_AND_ASSOCIATIONS',
  'PROFESSIONAL_SERVICES', 'RETAIL', 'TECHNOLOGY', 'TELECOM', 'TRAVEL', 'OTHER',
] as const;

const saveSchema = z.object({
  action: z.literal('save'),
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(100),
  prefixTemplate: z.string().trim().min(1).max(80),
  defaultCount: z.coerce.number().int().min(1).max(100),
  interval: z.coerce.number().int().min(5).max(3600),
  tokenId: z.string().uuid(),
  pageMode: z.enum(['random', 'fixed']),
  primaryPage: z.string().regex(/^\d{5,30}$/).optional().or(z.literal('')),
  timezone: z.coerce.number().int().min(1).max(1000),
  vertical: z.enum(verticals),
  adminEmail: z.string().trim().email().max(254).optional().or(z.literal('')),
});

const deleteSchema = z.object({
  action: z.literal('delete'),
  id: z.string().uuid(),
});

type PresetRecord = {
  id: string;
  name: string;
  prefixTemplate: string;
  defaultCount: number;
  interval: number;
  tokenId: string;
  tokenLabel: string;
  pageMode: 'random' | 'fixed';
  primaryPage?: string;
  timezone: number;
  vertical: typeof verticals[number];
  adminEmail?: string;
  createdAt: string;
  updatedAt: string;
};

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

export async function GET() {
  try {
    const user = await owner();
    const presets = ((await list(user, 'resource-preset')) as PresetRecord[])
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return Response.json({ presets });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 503 });
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
  }

  try {
    const user = await owner();
    const raw = await req.json() as Record<string, unknown>;

    if (raw.action === 'save') {
      const input = saveSchema.parse(raw);
      if (input.pageMode === 'fixed' && !input.primaryPage) {
        throw new Error('Preset dùng Page cố định phải có Page đại diện.');
      }
      const token = await getMetaTokenRecord(user, input.tokenId);
      const existing = input.id
        ? ((await list(user, 'resource-preset')) as PresetRecord[]).find((item) => item.id === input.id)
        : undefined;
      if (input.id && !existing) throw new Error('Không tìm thấy preset cần cập nhật.');

      const now = new Date().toISOString();
      const preset: PresetRecord = {
        id: existing?.id || crypto.randomUUID(),
        name: input.name,
        prefixTemplate: input.prefixTemplate,
        defaultCount: input.defaultCount,
        interval: input.interval,
        tokenId: token.id,
        tokenLabel: token.label,
        pageMode: input.pageMode,
        primaryPage: input.pageMode === 'fixed' ? input.primaryPage || undefined : undefined,
        timezone: input.timezone,
        vertical: input.vertical,
        adminEmail: input.adminEmail || undefined,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };

      await db().batch([
        put(user, 'resource-preset', preset as unknown as Record<string, unknown>),
        audit(user, `${existing ? 'Cập nhật' : 'Tạo'} preset tài nguyên: ${preset.name} · token ${preset.tokenLabel}`),
      ]);
      return Response.json({ preset, message: existing ? 'Đã cập nhật preset.' : 'Đã lưu preset.' });
    }

    if (raw.action === 'delete') {
      const input = deleteSchema.parse(raw);
      const rows = (await list(user, 'resource-preset')) as PresetRecord[];
      const preset = rows.find((item) => item.id === input.id);
      if (!preset) throw new Error('Không tìm thấy preset.');
      await db().batch([
        db().prepare('DELETE FROM records WHERE owner = ? AND kind = ? AND id = ?').bind(user, 'resource-preset', input.id),
        audit(user, `Xóa preset tài nguyên: ${preset.name}`),
      ]);
      return Response.json({ message: 'Đã xóa preset.' });
    }

    throw new Error('Thao tác preset không được hỗ trợ.');
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Cấu hình preset không hợp lệ.' }, { status: 400 });
    }
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
