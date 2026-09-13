'use client';

import { useEffect } from 'react';

type ImportItem = { label?: string; token: string };

const TOKEN_KEYS = new Set(['token', 'access_token', 'accesstoken', 'access-token', 'facebook_token', 'fb_token', 'bearer', 'authorization']);

function clean(value: string) {
  return value.replace(/^\uFEFF/, '').trim().replace(/^["'`]+|["'`,;]+$/g, '').trim();
}

function tokenScore(value: string, keyed = false) {
  const token = clean(value);
  if (token.length < 20 || token.length > 4096 || /\s/.test(token)) return -1;
  if (/^(https?:|file:|data:)/i.test(token)) return -1;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(token)) return -1;
  let score = keyed ? 20 : 0;
  if (/^EAA[A-Za-z0-9]/.test(token)) score += 12;
  if (/^[A-Za-z0-9._~+\/-]+$/.test(token)) score += 4;
  if (token.length >= 40) score += 4;
  if (token.length >= 80) score += 3;
  if (/\d/.test(token) && /[A-Za-z]/.test(token)) score += 2;
  return score;
}

function addItem(out: ImportItem[], seen: Set<string>, rawToken: string, rawLabel?: string, keyed = false) {
  const token = clean(rawToken);
  if (tokenScore(token, keyed) < 0 || seen.has(token)) return;
  seen.add(token);
  const label = clean(rawLabel || '').slice(0, 80) || undefined;
  out.push({ label, token });
}

function tokenFromUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of ['access_token', 'token', 'fb_token']) {
      const token = url.searchParams.get(key);
      if (token) return token;
    }
  } catch {
    // Not a URL.
  }
  return '';
}

function collectJson(value: unknown, out: ImportItem[], seen: Set<string>, inheritedLabel = '') {
  if (Array.isArray(value)) {
    value.forEach((item) => collectJson(item, out, seen, inheritedLabel));
    return;
  }
  if (typeof value === 'string') {
    addItem(out, seen, value, inheritedLabel);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  const labelValue = ['label', 'name', 'account', 'profile', 'uid', 'user']
    .map((key) => record[key])
    .find((item) => typeof item === 'string');
  const label = typeof labelValue === 'string' ? labelValue : inheritedLabel;

  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = rawKey.toLowerCase().replace(/\s+/g, '_');
    if (typeof rawValue === 'string' && TOKEN_KEYS.has(key)) addItem(out, seen, rawValue, label, true);
    else collectJson(rawValue, out, seen, label);
  }
}

function bestCandidate(fields: string[]) {
  let token = '';
  let score = -1;
  let index = -1;
  fields.forEach((field, fieldIndex) => {
    const fromUrl = tokenFromUrl(clean(field));
    const candidate = fromUrl || field;
    const nextScore = tokenScore(candidate, Boolean(fromUrl));
    if (nextScore > score || (nextScore === score && clean(candidate).length > token.length)) {
      token = clean(candidate);
      score = nextScore;
      index = fieldIndex;
    }
  });
  return { token, score, index };
}

function parseUniversalTokenText(input: string) {
  const out: ImportItem[] = [];
  const seen = new Set<string>();
  const normalized = input.replace(/^\uFEFF/, '').replace(/\u0000/g, '');
  const trimmed = normalized.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { collectJson(JSON.parse(trimmed), out, seen); } catch { /* Continue with tolerant line parsing. */ }
  }

  for (const original of normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
    if (/^(#|\/\/)/.test(original)) continue;
    const urlToken = tokenFromUrl(original);
    if (urlToken) {
      addItem(out, seen, urlToken, undefined, true);
      continue;
    }

    const keyValue = original.match(/^\s*([A-Za-z][A-Za-z0-9 _.-]{0,40})\s*[:=]\s*(.+?)\s*$/);
    if (keyValue && TOKEN_KEYS.has(keyValue[1].toLowerCase().trim().replace(/\s+/g, '_'))) {
      addItem(out, seen, keyValue[2], undefined, true);
      continue;
    }

    const line = original.replace(/^\s*[-*]\s+/, '');
    const quoted = Array.from(line.matchAll(/["'`]([^"'`\r\n]{20,4096})["'`]/g)).map((match) => match[1]);
    const separator = /\t|\||,|;/.test(line) ? /\s*(?:\t|\||,|;)\s*/ : /\s{2,}/;
    const fields = line.split(separator).map(clean).filter(Boolean);
    const best = bestCandidate(quoted.length ? [...fields, ...quoted] : fields);
    if (best.score >= 0) {
      const label = fields.filter((_, i) => i !== best.index).filter((part) => tokenScore(part) < 0).join(' ').slice(0, 80);
      addItem(out, seen, best.token, label);
      continue;
    }

    const fallback = bestCandidate(line.split(/\s+/).map(clean).filter(Boolean));
    if (fallback.score >= 0) addItem(out, seen, fallback.token);
  }

  if (!out.length && trimmed) {
    trimmed.split(/\s+/).map(clean).filter(Boolean).forEach((candidate) => addItem(out, seen, tokenFromUrl(candidate) || candidate));
  }
  return out;
}

async function decodeTokenFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = new Uint8Array(bytes.length - 2);
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      swapped[i - 2] = bytes[i + 1];
      swapped[i - 1] = bytes[i];
    }
    return new TextDecoder('utf-16le').decode(swapped);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function normalizedText(items: ImportItem[]) {
  return items.map((item) => item.label ? `${item.label}|${item.token}` : item.token).join('\n');
}

export default function TokenImportCompat() {
  useEffect(() => {
    const normalizedInputs = new WeakSet<HTMLInputElement>();

    const authorizeLocalUi = (main: Element) => {
      const confirmation = Array.from(main.querySelectorAll<HTMLLabelElement>('label'))
        .find((label) => label.textContent?.includes('Tôi xác nhận các token'));
      const checkbox = confirmation?.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (checkbox && !checkbox.checked) checkbox.click();
      if (confirmation) confirmation.style.display = 'none';
    };

    const patchTokenCheckUi = (main: Element) => {
      const table = main.querySelector('table');
      if (table) {
        for (const header of Array.from(table.querySelectorAll<HTMLTableCellElement>('th'))) {
          const text = header.textContent?.trim();
          if (text === 'Quyền chính') header.textContent = 'Quyền đang hoạt động';
          if (text === 'Quét') header.textContent = 'Check gần nhất';
        }

        for (const button of Array.from(table.querySelectorAll<HTMLButtonElement>('button'))) {
          if (button.textContent?.trim() === 'Check') {
            button.textContent = 'Check token';
            button.title = 'Kiểm tra token còn LIVE và đọc lại các permission đang được Meta trả về trạng thái granted.';
          }
        }
      }

      for (const button of Array.from(main.querySelectorAll<HTMLButtonElement>('button'))) {
        const text = button.textContent?.trim() || '';
        if (text.startsWith('Quét lại')) {
          const count = text.replace(/^Quét lại\s*/, '').trim();
          button.textContent = `Check token đã chọn${count ? ` ${count}` : ''}`;
          button.title = 'Check lại token đã chọn: trạng thái LIVE/DIE, quyền granted và tài nguyên token đang truy cập được.';
        }
      }

      const summaries = Array.from(main.querySelectorAll<HTMLElement>('div')).filter((node) => {
        const directText = Array.from(node.childNodes)
          .filter((child) => child.nodeType === Node.TEXT_NODE)
          .map((child) => child.textContent || '')
          .join(' ');
        return directText.includes('Hiển thị') && node.querySelector('select');
      });
      const summary = summaries[0];
      if (summary && !summary.querySelector('[data-token-check-help="1"]')) {
        const help = document.createElement('span');
        help.dataset.tokenCheckHelp = '1';
        help.textContent = 'Check token: LIVE khi /me gọi được; “Quyền đang hoạt động” chỉ hiện permission Meta trả về granted.';
        help.style.fontSize = '12px';
        help.style.opacity = '0.72';
        help.style.flexBasis = '100%';
        summary.appendChild(help);
      }
    };

    const patchUi = () => {
      const main = document.querySelector('.bulk-token-main');
      if (!main) return;
      const input = main.querySelector<HTMLInputElement>('input[type="file"]');
      if (input) {
        input.removeAttribute('accept');
        input.title = 'Chọn file token ở bất kỳ định dạng text phổ biến';
      }
      authorizeLocalUi(main);
      patchTokenCheckUi(main);
      const help = Array.from(main.querySelectorAll<HTMLParagraphElement>('p')).find((p) => p.textContent?.includes('Hỗ trợ TXT/CSV'));
      if (help) help.textContent = 'Nhận TXT, CSV, TSV, JSON, LOG, LST và file text không có đuôi; tự nhận token đứng riêng, label|token, nhiều cột, key=value, JSON hoặc URL có access_token. Hỗ trợ UTF-8 và UTF-16.';
    };

    const onChangeCapture = (event: Event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.closest('.bulk-token-main')) return;
      if (normalizedInputs.has(input)) {
        normalizedInputs.delete(input);
        return;
      }
      const source = input.files?.[0];
      if (!source) return;

      event.preventDefault();
      event.stopPropagation();
      if ('stopImmediatePropagation' in event) event.stopImmediatePropagation();

      void (async () => {
        const main = input.closest('.bulk-token-main');
        if (main) authorizeLocalUi(main);
        let text: string;
        try { text = await decodeTokenFile(source); } catch { text = await source.text(); }
        const items = parseUniversalTokenText(text);
        const replacement = new File([items.length ? normalizedText(items) : text], source.name || 'tokens.txt', { type: 'text/plain' });
        const transfer = new DataTransfer();
        transfer.items.add(replacement);
        input.files = transfer.files;
        normalizedInputs.add(input);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })();
    };

    document.addEventListener('change', onChangeCapture, true);
    const observer = new MutationObserver(patchUi);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(patchUi, 800);
    patchUi();
    return () => {
      document.removeEventListener('change', onChangeCapture, true);
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
