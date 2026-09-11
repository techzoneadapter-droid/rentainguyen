'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, LoaderCircle, Send } from 'lucide-react';

type Notice = { kind: 'success' | 'error'; message: string } | null;
type RowTarget = { metaId: string; element: Element };

type PushResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
  accepted?: Array<{ meta_id: string }>;
  rejected?: Array<{ index: number; error: string }>;
};

function metaIdFromRow(row: Element) {
  const text = row.querySelector('.asset-name small')?.textContent || '';
  return text.match(/\b\d{5,30}\b/)?.[0] || '';
}

function selectedMetaIds() {
  const ids = new Set<string>();
  const rows = document.querySelectorAll('.resources-panel tbody tr');
  for (const row of rows) {
    const checkbox = row.querySelector('td:first-child input[type="checkbox"]');
    if (!(checkbox instanceof HTMLInputElement) || !checkbox.checked) continue;
    const id = metaIdFromRow(row);
    if (id) ids.add(id);
  }
  return [...ids];
}

function sameTargets(a: RowTarget[], b: RowTarget[]) {
  return a.length === b.length && a.every((item, index) => item.metaId === b[index]?.metaId && item.element === b[index]?.element);
}

export default function CrmResourcePush() {
  const [selectionTarget, setSelectionTarget] = useState<Element | null>(null);
  const [rowTargets, setRowTargets] = useState<RowTarget[]>([]);
  const [busyKey, setBusyKey] = useState('');
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    const sync = () => {
      const nextSelection = document.querySelector('.resources-panel .selection-bar');
      setSelectionTarget((previous) => previous === nextSelection ? previous : nextSelection);

      const nextRows: RowTarget[] = [];
      for (const row of document.querySelectorAll('.resources-panel tbody tr')) {
        const metaId = metaIdFromRow(row);
        const cell = row.querySelector('td:last-child');
        if (metaId && cell) nextRows.push({ metaId, element: cell });
      }
      setRowTargets((previous) => sameTargets(previous, nextRows) ? previous : nextRows);
    };

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

  async function push(metaIds: string[], key: string) {
    if (!metaIds.length) {
      setNotice({
        kind: 'error',
        message: 'Không tìm thấy Meta ID. CRM chỉ nhận BM, TKQC hoặc Page đã có Meta ID.',
      });
      return;
    }

    setBusyKey(key);
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
      setBusyKey('');
    }
  }

  const selectionButton = selectionTarget
    ? createPortal(
        <button
          type="button"
          disabled={Boolean(busyKey)}
          onClick={() => void push(selectedMetaIds(), 'selection')}
          title="Đẩy các tài nguyên đang chọn sang kho BVAGC CRM"
        >
          {busyKey === 'selection' ? <LoaderCircle size={14} className="spin" /> : <Send size={14} />}
          {busyKey === 'selection' ? 'Đang push CRM…' : 'Push sang CRM'}
        </button>,
        selectionTarget,
      )
    : null;

  const rowButtons = rowTargets.map(({ metaId, element }) => createPortal(
    <button
      key={`crm-${metaId}`}
      className="button compact"
      type="button"
      disabled={Boolean(busyKey)}
      onClick={() => void push([metaId], metaId)}
      title={`Push tài nguyên ${metaId} sang BVAGC CRM`}
      style={{ marginLeft: 6, whiteSpace: 'nowrap' }}
    >
      {busyKey === metaId ? <LoaderCircle size={13} className="spin" /> : <Send size={13} />}
      {busyKey === metaId ? 'Đang push' : 'Push CRM'}
    </button>,
    element,
  ));

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

  return <>{selectionButton}{rowButtons}{noticePortal}</>;
}
