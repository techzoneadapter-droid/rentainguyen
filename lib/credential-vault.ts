import { env } from 'cloudflare:workers';

function vaultSecret() {
  const runtime = env as unknown as Record<string, string | undefined>;
  const secret = runtime.TOKEN_ENCRYPTION_KEY || process.env.TOKEN_ENCRYPTION_KEY || '';
  if (secret.length < 24) {
    throw new Error('Thiếu TOKEN_ENCRYPTION_KEY. Cần chuỗi ngẫu nhiên ít nhất 24 ký tự để mã hóa cookie/session.');
  }
  return secret;
}

async function aesKey() {
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(vaultSecret()));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function normalizeMetaCookie(value: string) {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('; ')
    .trim();
}

export function metaCookieUid(value: string) {
  const cookie = normalizeMetaCookie(value);
  const match = cookie.match(/(?:^|;\s*)c_user=(\d{5,30})(?:;|$)/i);
  return match?.[1] || '';
}

export function looksLikeMetaCookie(value: string) {
  const cookie = normalizeMetaCookie(value);
  return Boolean(metaCookieUid(cookie) && /(?:^|;\s*)(?:xs|datr|fr|sb)=/i.test(cookie));
}

export async function encryptCredential(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await aesKey(),
    new TextEncoder().encode(value),
  );
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptCredential(value: string) {
  const [ivText, cipherText] = String(value || '').split('.');
  if (!ivText || !cipherText) throw new Error('Dữ liệu session đã lưu không hợp lệ.');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(ivText) },
    await aesKey(),
    base64ToBytes(cipherText),
  );
  return new TextDecoder().decode(plain);
}

export async function credentialFingerprint(value: string) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(hash.slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
