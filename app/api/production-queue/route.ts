import { z } from 'zod';
import { audit, db, list, owner, put } from '../../../lib/server';
import { getMetaTokenRecord } from '../../../lib/meta-tokens';

const verticals = [
  'ADVERTISING', 'AUTOMOTIVE', 'CONSUMER_PACKAGED_GOODS', 'ECOMMERCE', 'EDUCATION',
  'ENERGY_AND_UTILITIES', 'ENTERTAINMENT_AND_MEDIA', 'FINANCIAL_SERVICES', 'GAMING',
  'GOVERNMENT_AND_POLITICS', 'MARKETING', 'ORGANIZATIONS_AND_ASSOCIATIONS',
  'PROFESSIONAL_SERVICES', 'RETAIL', 'TECHNOLOGY', 'TELECOM', 'TRAVEL', 'OTHER',
] as const;

const createSchema = z.object({
  action: z.literal('create'),
  name: z.string().trim().min(2).max(100),
  prefix: z.string().trim().min(1).max(80),
  count: z.coerce.number().int().min(1).max(100),
  interval: z.coerce.number().int().min(5).max(3600),
  tokenId: z.string().uuid(),
  pageMode: z.enum(['random', 'fixed']),
  primaryPage: z.string().regex(/^\d{5,30}$/).optional().or(z.literal('')),
  timezone: z.coerce.number().int().min(1).max(1000),
  vertical: z.enum(verticals),
  adminEmail: z.string().trim().email().max(254).optional().or(z.literal('')),
});

const idSchema = z.object({
  action: z.enum(['pause', 'resume', 'cancel', 'retry_failed']),
  id: z.string().uuid(),
});

const resultSchema = z.object({
  action: z.literal('record_result'),
  id: z.string().uuid(),
  index: z.coerce.number().int().min(0).max(99),
  success: z.boolean(),
  businessId: z.string().max(40).optional().default(''),
  pageId: z.string().max(40).optional().default(''),
  message: z.string().max(2000).optional().default(''),
});

type QueueItem = {
  index: number;
  name: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  businessId?: string;
  pageId?: string;
  message?: string;
  finishedAt?: string;
};

type QueueRecord = {
  id: string;
  name: string;
  prefix: string;
  count: number;
  interval: number;
  tokenId: string;
  tokenLabel: string;
  pageMode: 'random' | 'fixed';
  primaryPage?: string;
  timezone: number;
  vertical: typeof verticals[number];
  adminEmail?: string;
  status: 'READY' | 'PAUSED' | 'PAUSED_ERROR' | 'COMPLETED' | 'CANCELLED';
  completed: number;
  failed: number;
  nextAvailableAt: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  items: QueueItem[];
};

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

async function getQueue(user: string, id: string) {
  const rows = (await list(user, 'production-queue')) as QueueRecord[];
  const queue = rows.find((item) => item.id === id);
  if (!queue) throw new Error('Không tìm thấy hàng đợi.');
  return queue;
}

export async function GET() {
  try {
    const user = await owner();
    const queues = ((await list(user, 'production-queue')) as QueueRecord[])
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return Response.json({ queues });
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

    if (raw.action === 'create') {
      const input = createSchema.parse(raw);
      if (input.pageMode === 'fixed' && !input.primaryPage) {
        throw new Error('Chọn Page cố định hoặc chuyển sang chế độ Page ngẫu nhiên.');
      }
      const token = await getMetaTokenRecord(user, input.tokenId);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const items: QueueItem[] = Array.from({ length: input.count }, (_, index) => ({
        index,
        name: `${input.prefix} ${String(index + 1).padStart(3, '0')}`,
        status: 'PENDING',
      }));
      const queue: QueueRecord = {
        id,
        name: input.name,
        prefix: input.prefix,
        count: input.count,
        interval: input.interval,
        tokenId: token.id,
        tokenLabel: token.label,
        pageMode: input.pageMode,
        primaryPage: input.primaryPage || undefined,
        timezone: input.timezone,
        vertical: input.vertical,
        adminEmail: input.adminEmail || undefined,
        status: 'READY',
        completed: 0,
        failed: 0,
        nextAvailableAt: 0,
        createdAt: now,
        updatedAt: now,
        items,
      };
      await db().batch([
        put(user, 'production-queue', queue as unknown as Record<string, unknown>),
        audit(user, `Tạo hàng đợi sản xuất: ${queue.name} · ${queue.count} BM · token ${queue.tokenLabel}`),
      ]);
      return Response.json({ queue, message: 'Đã tạo hàng đợi. Mỗi lần bấm “Tạo mục tiếp theo” chỉ gửi 1 yêu cầu tạo BM.' });
    }

    if (raw.action === 'record_result') {
      const input = resultSchema.parse(raw);
      const queue = await getQueue(user, input.id);
      if (queue.status === 'CANCELLED' || queue.status === 'COMPLETED') throw new Error('Hàng đợi đã kết thúc.');
      const item = queue.items[input.index];
      if (!item || item.status !== 'PENDING') throw new Error('Mục hàng đợi không còn ở trạng thái chờ.');
      const now = new Date().toISOString();
      const items = queue.items.map((current) => current.index === input.index ? {
        ...current,
        status: input.success ? 'SUCCESS' as const : 'FAILED' as const,
        businessId: input.businessId || undefined,
        pageId: input.pageId || undefined,
        message: input.message || undefined,
        finishedAt: now,
      } : current);
      const completed = items.filter((current) => current.status === 'SUCCESS').length;
      const failed = items.filter((current) => current.status === 'FAILED').length;
      const pending = items.filter((current) => current.status === 'PENDING').length;
      const next: QueueRecord = {
        ...queue,
        items,
        completed,
        failed,
        status: input.success ? (pending ? 'READY' : 'COMPLETED') : 'PAUSED_ERROR',
        nextAvailableAt: input.success && pending ? Date.now() + queue.interval * 1000 : 0,
        updatedAt: now,
        lastError: input.success ? undefined : input.message || 'Tạo Business Manager thất bại.',
      };
      await db().batch([
        put(user, 'production-queue', next as unknown as Record<string, unknown>),
        audit(user, `${input.success ? 'Hoàn tất' : 'Lỗi'} hàng đợi ${queue.name} · mục ${input.index + 1}: ${item.name}`, input.success ? 'Hoàn tất' : 'Cần xử lý'),
      ]);
      return Response.json({ queue: next, message: input.success ? 'Đã ghi nhận Business Manager vừa tạo.' : 'Hàng đợi đã tạm dừng do lỗi. Không tự retry hoặc đổi token.' });
    }

    const input = idSchema.parse(raw);
    const queue = await getQueue(user, input.id);
    const now = new Date().toISOString();
    let next: QueueRecord = queue;

    if (input.action === 'pause') {
      if (queue.status !== 'READY') throw new Error('Chỉ có thể tạm dừng hàng đợi đang sẵn sàng.');
      next = { ...queue, status: 'PAUSED', updatedAt: now };
    } else if (input.action === 'resume') {
      if (!['PAUSED', 'PAUSED_ERROR'].includes(queue.status)) throw new Error('Hàng đợi không ở trạng thái tạm dừng.');
      next = { ...queue, status: 'READY', updatedAt: now, lastError: undefined };
    } else if (input.action === 'cancel') {
      if (['COMPLETED', 'CANCELLED'].includes(queue.status)) throw new Error('Hàng đợi đã kết thúc.');
      next = { ...queue, status: 'CANCELLED', updatedAt: now };
    } else if (input.action === 'retry_failed') {
      const failedIndex = queue.items.findIndex((item) => item.status === 'FAILED');
      if (failedIndex < 0) throw new Error('Không có mục lỗi để đưa về hàng chờ.');
      const items = queue.items.map((item, index) => index === failedIndex ? { index: item.index, name: item.name, status: 'PENDING' as const } : item);
      next = {
        ...queue,
        items,
        failed: Math.max(0, queue.failed - 1),
        status: 'READY',
        nextAvailableAt: 0,
        updatedAt: now,
        lastError: undefined,
      };
    }

    await db().batch([
      put(user, 'production-queue', next as unknown as Record<string, unknown>),
      audit(user, `${input.action} hàng đợi: ${queue.name}`),
    ]);
    return Response.json({ queue: next, message: 'Đã cập nhật hàng đợi.' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: 'Cấu hình hàng đợi không hợp lệ.' }, { status: 400 });
    }
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
