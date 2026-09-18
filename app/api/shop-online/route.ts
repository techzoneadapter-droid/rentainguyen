import { z } from 'zod';
import type { Asset } from '../../../lib/data';
import { runIndependentBatch } from '../../../lib/resource-model';
import { redactSecrets } from '../../../lib/redact';
import { pushBmToShop, shopConfiguration } from '../../../lib/shop-online';
import { audit, list, owner, put } from '../../../lib/server';

const schema = z.object({
  assetIds: z.array(z.string().min(1)).min(1).max(100),
  continueOnError: z.boolean().default(true),
  maxConsecutiveErrors: z.number().int().min(1).max(20).default(5),
});

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
}

export async function GET() {
  const config = shopConfiguration();
  return Response.json({ configured: Boolean(config.endpoint), endpoint: config.endpoint ? 'configured' : '' });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: 'Nguồn yêu cầu không hợp lệ.' }, { status: 403 });
  try {
    const workspaceOwner = await owner();
    const input = schema.parse(await req.json());
    const assets = await list(workspaceOwner, 'asset') as Asset[];
    const byId = new Map(assets.map((asset) => [asset.id, asset] as const));
    const selected = input.assetIds.map((id) => byId.get(id)).filter((asset): asset is Asset => Boolean(asset));
    if (!selected.length) throw new Error('Không tìm thấy BM đã chọn.');
    const results = await runIndependentBatch(selected, async (asset) => {
      if (asset.type !== 'BM') throw new Error('ADS/Page không được phép đẩy Shop.');
      await put(workspaceOwner, 'asset', { ...asset, shopStatus: 'pushing', shopError: '' }).run();
      try {
        const pushed = await pushBmToShop(asset);
        const now = new Date().toISOString();
        await put(workspaceOwner, 'asset', { ...asset, shopStatus: 'pushed', shopProductId: pushed.productId, shopSyncedAt: now, shopError: '' }).run();
        return { assetId: asset.id, productId: pushed.productId, idempotent: pushed.idempotent };
      } catch (error) {
        await put(workspaceOwner, 'asset', { ...asset, shopStatus: 'failed', shopError: redactSecrets((error as Error).message) }).run();
        throw error;
      }
    }, input);
    const successes = results.filter((result) => result.ok);
    const failures = results.filter((result) => !result.ok).map((result) => ({ assetId: result.item.id, businessId: result.item.metaId, name: result.item.name, error: redactSecrets((result.error as Error).message) }));
    await audit(workspaceOwner, `Đẩy Shop Online: ${successes.length} thành công, ${failures.length} thất bại`).run();
    return Response.json({
      ok: failures.length === 0,
      summary: { total: selected.length, processed: results.length, success: successes.length, failed: failures.length, skipped: selected.length - results.length },
      results: successes.map((result) => result.ok ? result.value : null).filter(Boolean),
      failures,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'Danh sách BM hoặc cấu hình batch không hợp lệ.' }, { status: 400 });
    return Response.json({ error: redactSecrets((error as Error).message) }, { status: 400 });
  }
}
