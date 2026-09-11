'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, LoaderCircle, Send } from 'lucide-react';

type Notice = { kind: 'success' | 'error'; message: string } | null;

type PushResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
  accepted?: Array<{ meta_id: string }>;
  rejected?: Array<{ index: number; error: string }>;
};

function selectedMetaIds() {
  const ids = new Set<string>();
  const rows = document.querySelectorAll('.resources-panel tbody tr');
  for (const row of rows) {
    const checkbox = row.querySelector('td:first-child input[type="checkbox"]');
    if (!(checkbox instanceof HTMLInputElement) || !checkbox.checked) continue;
    const text = row.querySelector('.asset-name small')?.textContent || '';
    const match = text.match(/\b\d{5,30}\b/);
    if (match) ids.add(match[0]);
  }
  return [...ids];
}

export default function CrmResourcePush() {
  const [target, setTarget] = useState<Element | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    const sync = () => setTarget(document.querySelector('.resources-panel .selection-bar'));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function pushSelected() {
    const metaIds = selectedMetaIds();
    if (!metaIds.length) {
      setNotice({
        kind: 'error',
        message: 'Không tìm thấy Meta ID trong các dòng đã chọn. CRM chỉ nhận BM, TKQC hoặc Page đã có Meta ID.',
      });
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/crm-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metaIds }),
      });
      const data = (await response.json()) as PushResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || 'Không đẩy được tài nguyên sang CRM.');
      const rejected = data.rejected?.length || 0;
      setNotice({
        kind: rejected ? 'error' : 'success',
        message: data.message || `Đã push ${data.accepted?.length || 0} tài nguyên sang CRM.`,
      });
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Không đẩy được tài nguyên sang CRM.' });
    } finally {
      setBusy(false);
    }
  }

  const button = target
    ? createPortal(
        <button type="button" disabled={busy} onClick={() => void pushSelected()} title="Đẩy tài nguyên đã chọn sang kho BVAGC CRM">
          {busy ? <LoaderCircle size={14} className="spin" /> : <Send size={14} />}
          {busy ? 'Đang push CRM…' : 'Push sang CRM'}
        </button>,
        target,
      )
    : null;

  const noticePortal = notice
    ? createPortal(
        <div
          role="status"
          onClick={() => setNotice(null)}
          style={{
            position: 'fixed',
            right: 22,
            top: 22,
            zIndex: 100000,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 9,
            maxWidth: 520,
            padding: '12px 14px',
            borderRadius: 10,
            boxShadow: '0 12px 36px rgba(0,0,0,.16)',
            background: notice.kind === 'success' ? '#eaf8ef' : '#fff0ef',
            color: notice.kind === 'success' ? '#176b37' : '#9c3531',
            cursor: 'pointer',
          }}
        >
          {notice.kind === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <span style={{ lineHeight: 1.45 }}>{notice.message}</span>
        </div>,
        document.body,
      )
    : null;

  return <>{button}{noticePortal}</>;
}
