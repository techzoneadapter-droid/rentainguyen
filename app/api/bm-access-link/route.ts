import { z } from 'zod';
import type { Asset } from '../../../lib/data';
import { generateBmAccessLink } from '../../../lib/bm-access-link';
import { runIndependentBatch } from '../../../lib/resource-model';
import { redactSecrets } from '../../../lib/redact';
import { audit, db, list, owner, put } from '../../../lib/server';

const schema = z.object({
  assetIds: z.array(z.string().min(1)).min(1).max(100),
  continueOnError: z.boolean().default(true),
  maxConsecutiveErrors: z.number().int().min(1).max(20).default(5),
});

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !origin || origin === new URL(req.url).origin;
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
      if (asset.type !== 'BM') throw new Error('Chỉ BM được phép sinh access link.');
      await put(workspaceOwner, 'asset', { ...asset, accessLinkStatus: 'generating', accessLinkError: '' }).run();
      try {
        const accessLink = await generateBmAccessLink(asset);
        const next: Asset = {
          ...asset,
          accessLink,
          accessLinkStatus: 'ready',
          accessLinkGeneratedAt: new Date().toISOString(),
          accessLinkError: '',
          shopStatus: 'ready',
        };
        await put(workspaceOwner, 'asset', next).run();
        return { assetId: asset.id, businessId: asset.metaId, accessLink };
      } catch (error) {
        await put(workspaceOwner, 'asset', { ...asset, accessLinkStatus: 'failed', accessLinkError: redactSecrets((error as Error).message), shopStatus: 'not_ready' }).run();
        throw error;
      }
    }, input);
    const successes = results.filter((result) => result.ok);
    const failures = results.filter((result) => !result.ok).map((result) => ({
      assetId: result.item.id,
      businessId: result.item.metaId,
      name: result.item.name,
      error: redactSecrets((result.error as Error).message),
    }));
    await db().batch([audit(workspaceOwner, `Sinh access link BM: ${successes.length} thành công, ${failures.length} thất bại`)]);
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
