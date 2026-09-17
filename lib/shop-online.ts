import { env } from 'cloudflare:workers';
import type { Asset } from './data';
import { buildShopPayload, shopIdempotencyKey, shopPushDisposition, shopValidationErrors } from './resource-model';

function runtimeEnv() {
  return env as unknown as Record<string, string | undefined>;
}

function text(value: unknown) {
  return value === undefined || value === null ? '' : String(value).trim();
}

export function shopConfiguration() {
  const config = runtimeEnv();
  return {
    endpoint: config.SHOP_API_URL || process.env.SHOP_API_URL || '',
    apiKey: config.SHOP_API_KEY || process.env.SHOP_API_KEY || '',
  };
}

export async function pushBmToShop(asset: Asset) {
  const missing = shopValidationErrors(asset);
  if (missing.length) throw new Error(`BM ${asset.name || asset.id} thiếu/không hợp lệ: ${missing.join(', ')}.`);
  if (shopPushDisposition(asset) === 'idempotent' && asset.shopProductId) {
    return { productId: asset.shopProductId, idempotent: true, response: {} as Record<string, unknown> };
  }
  const config = shopConfiguration();
  if (!config.endpoint) throw new Error('Chưa cấu hình SHOP_API_URL cho Shop Online.');
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      'Idempotency-Key': shopIdempotencyKey(asset),
    },
    body: JSON.stringify(buildShopPayload(asset)),
    signal: AbortSignal.timeout(25000),
  });
  const raw = await response.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(raw) as Record<string, unknown>; } catch { body = { message: raw.slice(0, 2000) }; }
  if (!response.ok) throw new Error(text(body.error) || text(body.message) || `Shop HTTP ${response.status}`);
  const productId = text(body.product_id || body.productId || body.id);
  if (!productId) throw new Error('Shop không trả product_id sau khi nhận BM.');
  return { productId, idempotent: false, response: body };
}
