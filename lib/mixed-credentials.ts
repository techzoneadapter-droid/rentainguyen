export type MixedImportItem = {
  label?: string;
  uid?: string;
  token?: string;
  cookie?: string;
};

export function cleanToken(value: unknown) {
  return String(value ?? '')
    .replace(/^\s*Bearer\s+/i, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+/g, '')
    .trim();
}

export function normalizeCookie(value: unknown) {
  return String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('; ')
    .trim();
}

export function cookieUid(cookie: string) {
  return cookie.match(/(?:^|;\s*)c_user=(\d{5,30})(?:;|$)/i)?.[1] || '';
}

export function looksLikeCookie(value: string) {
  const cookie = normalizeCookie(value);
  return Boolean(cookieUid(cookie) && /(?:^|;\s*)(?:xs|datr|fr|sb)=/i.test(cookie));
}

export function looksLikeToken(value: string, relaxed = false) {
  const token = cleanToken(value);
  if (token.length < 20 || token.length > 4096) return false;
  if (/^EAA/i.test(token)) return true;
  if (!relaxed) return false;
  return !/[;=\s]/.test(token) && /^[A-Za-z0-9._-]{20,}$/.test(token);
}

function tokenFromSegment(value: string) {
  const match = value.match(/^(?:access_?token|token)\s*[:=]\s*['"]?(.+?)['"]?$/i);
  return cleanToken(match?.[1] || value);
}

function isCookiePair(value: unknown): value is { name: string; value: string } {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.name === 'string' && typeof row.value === 'string';
}

function cookieFromPairs(pairs: Array<{ name: string; value: string }>) {
  const parts = pairs
    .filter((item) => item.name && item.value)
    .map((item) => `${item.name}=${item.value}`);
  return normalizeCookie(parts.join('; '));
}

function cookiePairsFromUnknown(value: unknown): Array<{ name: string; value: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter(isCookiePair);
}

function pushNormalized(push: (item: MixedImportItem) => void, item: MixedImportItem) {
  const cookie = item.cookie ? normalizeCookie(item.cookie) : '';
  const token = item.token ? cleanToken(item.token) : '';
  const cookieId = cookie ? cookieUid(cookie) : '';
  const uid = item.uid && /^\d{5,30}$/.test(item.uid) ? item.uid : cookieId;
  if (cookie && uid && cookieId && uid !== cookieId) return;
  if (!cookie && !token) return;
  push({
    label: item.label?.trim().slice(0, 80) || undefined,
    uid: uid || undefined,
    cookie: cookie && looksLikeCookie(cookie) ? cookie : undefined,
    token: token && looksLikeToken(token, true) ? token : undefined,
  });
}

function parseJsonInput(input: string, push: (item: MixedImportItem) => void) {
  try {
    const root = JSON.parse(input) as unknown;
    const rootPairs = cookiePairsFromUnknown(root);
    if (rootPairs.length && looksLikeCookie(cookieFromPairs(rootPairs))) {
      pushNormalized(push, { cookie: cookieFromPairs(rootPairs), uid: cookieUid(cookieFromPairs(rootPairs)) });
      return true;
    }

    const walk = (value: unknown, inheritedLabel = ''): void => {
      if (Array.isArray(value)) {
        const pairs = cookiePairsFromUnknown(value);
        if (pairs.length && looksLikeCookie(cookieFromPairs(pairs))) {
          pushNormalized(push, {
            label: inheritedLabel || undefined,
            cookie: cookieFromPairs(pairs),
            uid: cookieUid(cookieFromPairs(pairs)),
          });
          return;
        }
        value.forEach((item) => walk(item, inheritedLabel));
        return;
      }
      if (!value || typeof value !== 'object') return;
      const row = value as Record<string, unknown>;
      const label = String(row.label ?? row.name ?? row.email ?? inheritedLabel ?? '').trim();
      const rawCookie = row.cookie ?? row.cookies ?? row.session_cookie ?? row.browser_cookie;
      const pairCookie = cookieFromPairs(cookiePairsFromUnknown(rawCookie));
      const cookieSource = typeof rawCookie === 'string' ? rawCookie : pairCookie;
      const rawToken = row.access_token ?? row.accessToken ?? row.token;
      const rawUid = row.uid ?? row.user_id ?? row.userId ?? row.c_user;
      const cookie = cookieSource ? normalizeCookie(cookieSource) : '';
      const token = rawToken ? cleanToken(rawToken) : '';
      const uid = String(rawUid ?? '').trim() || cookieUid(cookie);

      if ((cookie && looksLikeCookie(cookie)) || (token && looksLikeToken(token, true))) {
        pushNormalized(push, {
          label: label && !looksLikeCookie(label) ? label : undefined,
          uid: /^\d{5,30}$/.test(uid) ? uid : undefined,
          cookie: cookie && looksLikeCookie(cookie) ? cookie : undefined,
          token: token && looksLikeToken(token, true) ? token : undefined,
        });
      }

      for (const child of Object.values(row)) {
        if (child && typeof child === 'object') walk(child, label);
      }
    };
    walk(root);
    return true;
  } catch {
    return false;
  }
}

function parseStructuredLine(trimmed: string): MixedImportItem | null {
  const parts = trimmed.split(/[|\t,]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return null;

  let label = '';
  let uid = '';
  let cookie = '';
  let token = '';
  let cookieIndex = -1;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!cookie && looksLikeCookie(part)) {
      cookie = normalizeCookie(part);
      cookieIndex = index;
      uid ||= cookieUid(cookie);
      continue;
    }
    if (!uid && /^\d{5,30}$/.test(part)) {
      uid = part;
      continue;
    }
    const explicit = part.match(/^(?:access_?token|token)\s*[:=]\s*(.+)$/i)?.[1] || '';
    if (!token && explicit && looksLikeToken(explicit, true)) {
      token = cleanToken(explicit);
      continue;
    }
    if (!token && looksLikeToken(part, false)) {
      token = cleanToken(part);
      continue;
    }
  }

  if (!token && cookieIndex >= 0) {
    for (let index = parts.length - 1; index > cookieIndex; index -= 1) {
      const candidate = tokenFromSegment(parts[index]);
      if (looksLikeToken(candidate, true)) {
        token = candidate;
        break;
      }
    }
  }

  for (const part of parts) {
    if (part === cookie || part === token || part === uid) continue;
    if (/^(?:access_?token|token)\s*[:=]/i.test(part)) continue;
    if (!label && !looksLikeCookie(part) && !/^\d{5,30}$/.test(part)) label = part.slice(0, 80);
  }

  if (!cookie && !token) return null;
  return {
    label: label || undefined,
    uid: uid || (cookie ? cookieUid(cookie) : '') || undefined,
    cookie: cookie || undefined,
    token: token || undefined,
  };
}

function parseTextLine(line: string): MixedImportItem | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const structured = parseStructuredLine(trimmed);
  if (structured) return structured;

  if (looksLikeCookie(trimmed)) {
    const cookie = normalizeCookie(trimmed);
    return { uid: cookieUid(cookie), cookie };
  }

  const accessMatch = trimmed.match(/(?:^|\s)(?:access_?token|token)\s*[:=]\s*['"]?([^'"\s|,]+)/i);
  if (accessMatch && looksLikeToken(accessMatch[1], true)) {
    return { token: cleanToken(accessMatch[1]) };
  }

  const token = tokenFromSegment(trimmed);
  if (looksLikeToken(token, true)) return { token };
  return null;
}

function mergeAdjacentRows(rows: MixedImportItem[]) {
  const merged: MixedImportItem[] = [];
  for (const item of rows) {
    const prev = merged[merged.length - 1];
    const sameUid = !item.uid || !prev?.uid || item.uid === prev.uid;
    if (prev && sameUid && !prev.token && item.token && !item.cookie) {
      prev.token = item.token;
      prev.label = prev.label || item.label;
      prev.uid = prev.uid || item.uid;
      continue;
    }
    if (prev && sameUid && !prev.cookie && item.cookie && !item.token) {
      prev.cookie = item.cookie;
      prev.uid = prev.uid || item.uid;
      prev.label = prev.label || item.label;
      continue;
    }
    merged.push({ ...item });
  }
  return merged;
}

export function parseMixedInput(input: string) {
  const rows: MixedImportItem[] = [];
  const seen = new Set<string>();
  const push = (item: MixedImportItem) => {
    const cookie = item.cookie ? normalizeCookie(item.cookie) : '';
    const token = item.token ? cleanToken(item.token) : '';
    const cookieId = cookie ? cookieUid(cookie) : '';
    const uid = item.uid && /^\d{5,30}$/.test(item.uid) ? item.uid : cookieId;
    if (cookie && uid && cookieId && uid !== cookieId) return;
    if (!cookie && !token) return;
    const key = `${uid || '-'}|${cookie || '-'}|${token || '-'}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      label: item.label?.trim().slice(0, 80) || undefined,
      uid: uid || undefined,
      cookie: cookie || undefined,
      token: token || undefined,
    });
  };

  const parsedJson = parseJsonInput(input, push);
  if (!parsedJson) {
    for (const rawLine of input.split(/\r?\n/)) {
      const item = parseTextLine(rawLine);
      if (item) push(item);
    }
  }

  return mergeAdjacentRows(rows);
}
