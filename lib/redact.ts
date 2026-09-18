/**
 * Redact credential khỏi text trước khi đưa vào error/log/audit/response.
 * Không thay thế vault (AES-GCM); chỉ là lớp chống lộ khi message mang theo token/cookie.
 */

const SECRET_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'access_token', pattern: /access_token=[A-Za-z0-9._-]{8,}/gi },
  { label: 'bearer', pattern: /(?:Bearer|OAuth)\s+[A-Za-z0-9._|_-]{12,}/gi },
  { label: 'EA token', pattern: /\bEA[A-Za-z0-9]{20,}/g },
  { label: 'fb_dtsg', pattern: /(?:fb_dtsg|"dtsg")[=:")\s]*([A-Za-z0-9:_-]{8,})/gi },
  { label: 'c_user', pattern: /c_user=(\d{5,30})/gi },
  { label: 'xs', pattern: /(?:^|;\s*)xs=[^;\s]+/gi },
  { label: 'datr', pattern: /(?:^|;\s*)datr=[^;\s]+/gi },
  { label: 'fr', pattern: /(?:^|;\s*)fr=[^;\s]+/gi },
  { label: 'sb', pattern: /(?:^|;\s*)sb=[^;\s]+/gi },
];

function redactCookiePairs(text: string) {
  // Còn lại: bất kỳ cặp key=valeur dạng cookie của các khóa nhạy cảm chưa liệt kê.
  return text.replace(/(?:^|;)\s*(authorization|cookie|session_cookie|token)\s*[:=]\s*[^;\s]{8,}/gi, (match) => {
    const key = match.replace(/[:=].*$/, '').trim();
    return `${key}=[REDACTED]`;
  });
}

/** Che mọi credential nhận dạng được trong một chuỗi message/audit. */
export function redactSecrets(value: unknown) {
  let text = String(value ?? '');
  for (const { pattern } of SECRET_PATTERNS) text = text.replace(pattern, (match) => {
    const prefix = match.slice(0, Math.min(6, match.length));
    return `${prefix}…[REDACTED]`;
  });
  return redactCookiePairs(text);
}

/** Redact đệ quy trên object trước khi trả JSON cho client hoặc ghi audit. */
export function redactSecretsDeep<T>(value: T): T {
  if (typeof value === 'string') return redactSecrets(value) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => redactSecretsDeep(item)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = /token|cookie|secret|authorization|dtsg/i.test(key) && item
        ? '[REDACTED]'
        : redactSecretsDeep(item);
    }
    return out as unknown as T;
  }
  return value;
}
