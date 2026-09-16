'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BadgeCheck, FileUp, KeyRound, LoaderCircle, RefreshCw } from 'lucide-react';

type MixedImportItem = {
  label?: string;
  uid?: string;
  token?: string;
  cookie?: string;
};

type SessionMeta = {
  id: string;
  label: string;
  uid: string;
  updated: string;
};

type Inventory = {
  tokenId: string;
  status: string;
};

function cleanToken(value: unknown) {
  return String(value ?? '')
    .replace(/^\s*Bearer\s+/i, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function normalizeCookie(value: unknown) {
  return String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('; ')
    .trim();
}

function cookieUid(cookie: string) {
  return cookie.match(/(?:^|;\s*)c_user=(\d{5,30})(?:;|$)/i)?.[1] || '';
}

function looksLikeCookie(value: string) {
  const cookie = normalizeCookie(value);
  return Boolean(cookieUid(cookie) && /(?:^|;\s*)(?:xs|datr|fr|sb)=/i.test(cookie));
}

function looksLikeToken(value: string, relaxed = false) {
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

function parseJsonInput(input: string, push: (item: MixedImportItem) => void) {
  try {
    const root = JSON.parse(input) as unknown;
    const walk = (value: unknown, inheritedLabel = ''): void => {
      if (Array.isArray(value)) {
        value.forEach((item) => walk(item, inheritedLabel));
        return;
      }
      if (!value || typeof value !== 'object') return;
      const row = value as Record<string, unknown>;
      const label = String(row.label ?? row.name ?? row.email ?? inheritedLabel ?? '').trim();
      const rawCookie = row.cookie ?? row.cookies ?? row.session_cookie ?? row.browser_cookie;
      const rawToken = row.access_token ?? row.accessToken ?? row.token;
      const rawUid = row.uid ?? row.user_id ?? row.userId ?? row.c_user;
      const cookie = rawCookie ? normalizeCookie(rawCookie) : '';
      const token = rawToken ? cleanToken(rawToken) : '';
      const uid = String(rawUid ?? '').trim() || cookieUid(cookie);

      if ((cookie && looksLikeCookie(cookie)) || (token && looksLikeToken(token, true))) {
        push({
          label: label || undefined,
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
  const parts = trimmed.split(/[|\t]/).map((part) => part.trim()).filter(Boolean);
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
    if (!label && !looksLikeCookie(part)) label = part.slice(0, 80);
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

  const accessMatch = trimmed.match(/(?:^|\s)(?:access_?token|token)\s*[:=]\s*['"]?([^'"\s|]+)/i);
  if (accessMatch && looksLikeToken(accessMatch[1], true)) {
    return { token: cleanToken(accessMatch[1]) };
  }

  const token = tokenFromSegment(trimmed);
  if (looksLikeToken(token, true)) return { token };
  return null;
}

function parseMixedInput(input: string) {
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

  return rows;
}

function decodeFile(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  return new TextDecoder('utf-8').decode(buffer);
}

async function jsonFetch<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export default function MixedCredentialImport() {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sessionCount, setSessionCount] = useState<number | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const parsed = useMemo(() => parseMixedInput(text), [text]);
  const tokenCount = parsed.filter((item) => item.token).length;
  const cookieCount = parsed.filter((item) => item.cookie).length;
  const pairedCount = parsed.filter((item) => item.token && item.cookie).length;

  useEffect(() => {
    let frame = 0;
    const locate = () => {
      const textarea = document.querySelector<HTMLTextAreaElement>('textarea[placeholder*="Dán token"]');
      const target = textarea?.parentElement?.parentElement as HTMLElement | null;
      if (target === targetRef.current) return;
      if (targetRef.current) targetRef.current.removeAttribute('data-mixed-credential-target');
      targetRef.current = target;
      if (target) target.setAttribute('data-mixed-credential-target', 'true');
      setPortalTarget(target);
    };
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(locate);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      if (targetRef.current) targetRef.current.removeAttribute('data-mixed-credential-target');
    };
  }, []);

  async function loadSessions() {
    try {
      const data = await jsonFetch<{ sessions?: SessionMeta[] }>('/api/session-vault', { cache: 'no-store' });
      setSessionCount(data.sessions?.length || 0);
    } catch {
      setSessionCount(0);
    }
  }

  async function onFile(file: File | null) {
    setFileName(file?.name || '');
    setError('');
    setMessage('');
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('File tối đa 5 MB.');
      return;
    }
    setText(decodeFile(await file.arrayBuffer()));
  }

  async function importAll() {
    if (!parsed.length) {
      setError('Không tìm thấy UID/cookie/token hợp lệ trong dữ liệu đã nhập.');
      return;
    }
    if (parsed.length > 200) {
      setError('Mỗi lượt tối đa 200 dòng/tài khoản.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      const cookieItems = parsed.filter((item) => item.cookie).map((item) => ({
        label: item.label,
        uid: item.uid,
        cookie: item.cookie as string,
      }));
      const tokenItems = parsed.filter((item) => item.token).map((item) => ({
        label: item.label || (item.uid ? `UID ${item.uid}` : undefined),
        uid: item.uid,
        token: item.token as string,
      }));

      let newSessions = 0;
      let updatedSessions = 0;
      let liveSessions = 0;
      const savedSessionIds: string[] = [];
      for (let index = 0; index < cookieItems.length; index += 50) {
        const chunk = cookieItems.slice(index, index + 50);
        const data = await jsonFetch<{ imported?: number; updated?: number; sessions?: SessionMeta[] }>('/api/session-vault', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'import', items: chunk }),
        });
        newSessions += data.imported || 0;
        updatedSessions += data.updated || 0;
        savedSessionIds.push(...(data.sessions || []).map((session) => session.id));
      }

      if (savedSessionIds.length) {
        const checked = await jsonFetch<{ live?: number }>('/api/session-vault', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'check', ids: savedSessionIds.slice(0, 50) }),
        });
        liveSessions = checked.live || 0;
      }

      let checkedTokens = 0;
      let liveTokens = 0;
      let syncedResources = 0;
      for (let index = 0; index < tokenItems.length; index += 20) {
        const chunk = tokenItems.slice(index, index + 20);
        const data = await jsonFetch<{ processed?: number; inventories?: Inventory[] }>('/api/token-runtime', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'import', items: chunk }),
        });
        checkedTokens += data.processed || 0;
        for (const inventory of data.inventories || []) {
          if (inventory.status !== 'active') continue;
          liveTokens += 1;
          try {
            const sync = await jsonFetch<{ imported?: number }>('/api/resource-create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'import_token', tokenId: inventory.tokenId }),
            });
            syncedResources += sync.imported || 0;
          } catch {
            // Token vẫn được lưu/check; có thể đồng bộ lại trong Resource Console.
          }
        }
      }

      setMessage(`Đã xử lý ${parsed.length} dòng · session mới ${newSessions} · cập nhật ${updatedSessions} · session LIVE ${liveSessions} · token check ${checkedTokens} · LIVE ${liveTokens} · tài nguyên ${syncedResources}.`);
      setText('');
      setFileName('');
      if (inputRef.current) inputRef.current.value = '';
      await loadSessions();
      window.dispatchEvent(new CustomEvent('meta-credentials-imported'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!portalTarget) return null;

  const panel = (
    <div data-mixed-credential-slot="true" style={{ width: '100%' }}>
      <style>{`[data-mixed-credential-target="true"] > :not([data-mixed-credential-slot="true"]) { display:none !important; } [data-mixed-credential-target="true"] { display:block !important; }`}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#4f46e5', fontSize: 11, fontWeight: 800 }}><KeyRound size={14}/> BỘ LỌC TÀI KHOẢN</div>
          <strong style={{ display: 'block', fontSize: 15, marginTop: 4 }}>Nạp UID + Cookie + Token</strong>
          <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: '#6b7488' }}>Nhận file text/JSON, tự tách cookie và token; cookie được mã hóa trước khi lưu.</span>
        </div>
        <button type="button" onClick={() => void loadSessions()} disabled={busy} style={{ border: '1px solid #d8deea', background: '#fff', borderRadius: 9, padding: '7px 10px', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <RefreshCw size={13}/> {sessionCount === null ? 'Kiểm tra session' : `${sessionCount} session đã lưu`}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 250px', gap: 12 }}>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={'Ví dụ:\n123456789|c_user=123456789; xs=...; datr=...|EAA...\nhoặc dán JSON có uid, cookie, access_token'}
          style={{ minHeight: 118, resize: 'vertical', border: '1px solid #d9e0eb', borderRadius: 10, padding: 12, font: '12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace', width: '100%' }}
        />
        <label style={{ minHeight: 118, border: '1px dashed #b9c6da', borderRadius: 10, display: 'grid', placeItems: 'center', alignContent: 'center', gap: 6, cursor: 'pointer', color: '#475569', textAlign: 'center', padding: 12 }}>
          <input ref={inputRef} type="file" onChange={(event) => void onFile(event.target.files?.[0] || null)} style={{ display: 'none' }}/>
          <FileUp size={26}/><strong>{fileName || 'Chọn file tài khoản'}</strong><span style={{ fontSize: 10 }}>Text / JSON · UTF-8 / UTF-16</span>
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginTop: 10 }}>
        <span style={{ fontSize: 10, padding: '5px 8px', borderRadius: 999, background: '#eef2ff' }}>Nhận diện {parsed.length}</span>
        <span style={{ fontSize: 10, padding: '5px 8px', borderRadius: 999, background: '#eefbf3' }}>Cookie {cookieCount}</span>
        <span style={{ fontSize: 10, padding: '5px 8px', borderRadius: 999, background: '#eff6ff' }}>Token {tokenCount}</span>
        <span style={{ fontSize: 10, padding: '5px 8px', borderRadius: 999, background: '#fff7ed' }}>Ghép đôi {pairedCount}</span>
        <button type="button" onClick={() => void importAll()} disabled={busy || !parsed.length} style={{ marginLeft: 'auto', border: 0, borderRadius: 10, padding: '9px 14px', color: '#fff', background: 'linear-gradient(90deg,#3972f6,#7654df)', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 7, cursor: busy ? 'default' : 'pointer', opacity: busy || !parsed.length ? .55 : 1 }}>
          {busy ? <LoaderCircle size={14} style={{ animation: 'spin 1s linear infinite' }}/> : <BadgeCheck size={14}/>} {busy ? 'Đang xử lý…' : 'Nạp + Lọc + Check'}
        </button>
      </div>

      {message && <div style={{ marginTop: 9, background: '#edf9f1', color: '#247447', borderRadius: 8, padding: '8px 10px', fontSize: 11 }}>{message}</div>}
      {error && <div style={{ marginTop: 9, background: '#fff1f2', color: '#b4233c', borderRadius: 8, padding: '8px 10px', fontSize: 11 }}>{error}</div>}
    </div>
  );

  return createPortal(panel, portalTarget);
}
