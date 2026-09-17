import { env } from 'cloudflare:workers';
import type { Asset } from './data';
import { canonicalOpenUrl, metaAssetId } from './resource-model';

function runtimeEnv() {
  return env as unknown as Record<string, string | undefined>;
}

function text(value: unknown) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function safeUrl(value: unknown) {
  const raw = text(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

export async function generateBmAccessLink(asset: Asset) {
  if (asset.type !== 'BM') throw new Error('Chỉ Business Manager mới có thể sinh access link.');
  const businessId = metaAssetId(asset);
  if (!businessId) throw new Error('BM không có Business ID hợp lệ.');
  const config = runtimeEnv();
  const endpoint = config.BM_ACCESS_LINK_ENDPOINT || process.env.BM_ACCESS_LINK_ENDPOINT || '';
  const apiKey = config.BM_ACCESS_LINK_API_KEY || process.env.BM_ACCESS_LINK_API_KEY || '';
  if (!endpoint) {
    throw new Error('Chưa cấu hình BM_ACCESS_LINK_ENDPOINT. Meta Graph công khai không cung cấp link bàn giao dùng chung; hệ thống sẽ không giả accessLink bằng URL mở Business Settings.');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      'Idempotency-Key': asset.id,
    },
    body: JSON.stringify({ resource_id: asset.id, business_id: businessId }),
    signal: AbortSignal.timeout(25000),
  });
  const raw = await response.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(raw) as Record<string, unknown>; } catch { body = { message: raw.slice(0, 2000) }; }
  if (!response.ok) throw new Error(text(body.error) || text(body.message) || `Access-link provider HTTP ${response.status}`);
  const link = safeUrl(body.access_link || body.accessLink || body.link);
  if (!link) throw new Error('Access-link provider không trả access_link HTTPS hợp lệ.');
  const openUrl = canonicalOpenUrl(asset);
  if (link === openUrl || /business\.facebook\.com\/settings\/?\?business_id=/i.test(link)) {
    throw new Error('Provider trả openUrl của Business Settings, không phải accessLink bàn giao.');
  }
  return link;
}
