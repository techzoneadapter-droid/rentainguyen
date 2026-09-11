'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Filter, LoaderCircle, Send, X } from 'lucide-react';

type Notice = { kind: 'success' | 'error'; message: string } | null;
type RowTarget = { metaId: string; element: Element };
type Asset = {
  id: string;
  metaId?: string;
  name: string;
  type: string;
  status: string;
  country?: string;
};

type WorkspaceResponse = { assets?: Asset[]; error?: string };
type PushResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
  accepted?: Array<{ meta_id: string }>;
  rejected?: Array<{ index: number; error: string }>;
};

type StatusFilter = 'ALL' | 'LIVE' | 'DIE' | 'RESTRICTED' | 'OTHER';
type TypeFilter = 'ALL' | 'BM' | 'TKQC' | 'Page';

function metaIdFromAsset(asset: Asset) {
  if (asset.metaId && /^\d{5,30}$/.test(asset.metaId)) return asset.metaId;
  const match = asset.id.match(/(?:^|:)meta:(\d{5,30})(?:$|:)/) || asset.id.match(/(\d{5,30})$/);
  return match?.[1] || '';
}

function metaIdFromRow(row: Element) {
  const text = row.querySelector('.asset-name small')?.textContent || '';
  return text.match(/\b\d{5,30}\b/)?.[0] || '';
}

function statusGroup(status: string): Exclude<StatusFilter, 'ALL'> {
  const raw = String(status || '').trim();
  const value = raw.toLowerCase();
  if (raw === 'LIVE' || value.includes('truy cập') || value.includes('truy cáº­p')) return 'LIVE';
  if (raw === 'DIE' || value.includes('disabled') || value.includes('vô hiệu') || value.includes('vÃ´ hiá»‡u')) return 'DIE';
  if (value.includes('hạn chế') || value.includes('háº¡n cháº¿') || value.includes('restricted')) return 'RESTRICTED';
  return 'OTHER';
}

function supported(asset: Asset) {
  return ['BM', 'TKQC', 'Page'].includes(asset.type) && Boolean(metaIdFromAsset(asset));
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

function chunks<T>(values: T[], size: number) {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

export default function CrmResourcePush() {
  const [selectionTarget, setSelectionTarget] = useState<Element | null>(null);
  const [toolbarTarget, setToolbarTarget] = useState<Element | null>(null);
  const [rowTargets, setRowTargets] = useState<RowTarget[]>([]);
  const [busyKey, setBusyKey] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [open, setOpen] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [type, setType] = useState<TypeFilter>('ALL');
  const [query, setQuery] = useState('');
  const [progress, setProgress] = useState('');

  useEffect(() => {
    const sync = () => {
      const nextSelection = document.querySelector('.resources-panel .selection-bar');
      setSelectionTarget((previous) => previous === nextSelection ? previous : nextSelection);

      const nextToolbar = document.querySelector('.resources-panel .panel-heading');
      setToolbarTarget((previous) => previous === nextToolbar ? previous : nextToolbar);

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

  const eligible = useMemo(() => assets.filter(supported), [assets]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return eligible.filter((asset) => {
      if (type !== 'ALL' && asset.type !== type) return false;
      if (status !== 'ALL' && statusGroup(asset.status) !== status) return false;
      if (q && !`${asset.name} ${metaIdFromAsset(asset)} ${asset.status}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [eligible, query, status, type]);

  const counts = useMemo(() => ({
    all: eligible.length,
    live: eligible.filter((asset) => statusGroup(asset.status) === 'LIVE').length,
    die: eligible.filter((asset) => statusGroup(asset.status) === 'DIE').length,
    restricted: eligible.filter((asset) => statusGroup(asset.status) === 'RESTRICTED').length,
  }), [eligible]);

  async function loadAssets() {
    setLoadingAssets(true);
    try {
      const response = await fetch('/api/workspace', { cache: 'no-store' });
      const data = (await response.json()) as WorkspaceResponse;
      if (!response.ok) throw new Error(data.error || 'Không tải được danh sách tài nguyên.');
      setAssets(data.assets || []);
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Không tải được danh sách tài nguyên.' });
    } finally {
      setLoadingAssets(false);
    }
  }

  async function openBulk() {
    setOpen(true);
    setProgress('');
    await loadAssets();
  }

  async function push(metaIds: string[], key: string) {
    if (!metaIds.length) {
      setNotice({ kind: 'error', message: 'Không có tài nguyên phù hợp để đẩy sang CRM.' });
      return { accepted: 0, rejected: 0 };
    }

    setBusyKey(key);
    try {
      let accepted = 0;
      let rejected = 0;
      const batches = chunks(metaIds, 100);
      for (let index = 0; index < batches.length; index += 1) {
        setProgress(batches.length > 1 ? `Đang gửi lô ${index + 1}/${batches.length}…` : 'Đang gửi sang CRM…');
        const response = await fetch('/api/crm-push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ metaIds: batches[index] }),
        });
        const data = (await response.json()) as PushResponse;
        if (!response.ok || !data.ok) throw new Error(data.error || 'Không đẩy được tài nguyên sang CRM.');
        accepted += data.accepted?.length || 0;
        rejected += data.rejected?.length || 0;
      }
      setNotice({
        kind: rejected ? 'error' : 'success',
        message: rejected
          ? `Đã đẩy ${accepted} tài nguyên sang CRM; ${rejected} tài nguyên bị từ chối.`
          : `Đã đẩy ${accepted} tài nguyên sang CRM.`,
      });
      await loadAssets();
      return { accepted, rejected };
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Không đẩy được tài nguyên sang CRM.' });
      return { accepted: 0, rejected: 0 };
    } finally {
      setBusyKey('');
      setProgress('');
    }
  }

  async function pushFiltered() {
    const ids = filtered.map(metaIdFromAsset).filter(Boolean);
    if (!ids.length) {
      setNotice({ kind: 'error', message: 'Bộ lọc hiện tại không có tài nguyên nào có Meta ID để đẩy.' });
      return;
    }
    if (!window.confirm(`Đẩy ${ids.length} tài nguyên đang khớp bộ lọc sang kho CRM?`)) return;
    await push(ids, 'bulk');
  }

  const bulkButton = (
    <button
      type="button"
      className="button"
      disabled={Boolean(busyKey)}
      onClick={() => void openBulk()}
      title="Lọc LIVE/DIE và đẩy hàng loạt sang CRM"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}
    >
      <Send size={15} /> Đẩy sang CRM
    </button>
  );

  const toolbarButton = toolbarTarget
    ? createPortal(<span style={{ marginLeft: 8 }}>{bulkButton}</span>, toolbarTarget)
    : createPortal(
        <div style={{ position: 'fixed', right: 330, bottom: 18, zIndex: 78 }}>{bulkButton}</div>,
        document.body,
      );

  const selectionButton = selectionTarget
    ? createPortal(
        <button
          type="button"
          disabled={Boolean(busyKey)}
          onClick={() => void push(selectedMetaIds(), 'selection')}
          title="Đẩy các tài nguyên đang chọn sang kho CRM"
        >
          {busyKey === 'selection' ? <LoaderCircle size={14} className="spin" /> : <Send size={14} />}
          {busyKey === 'selection' ? 'Đang đẩy…' : 'Đẩy sang CRM'}
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
      title={`Đẩy tài nguyên ${metaId} sang CRM`}
      style={{ marginLeft: 6, whiteSpace: 'nowrap' }}
    >
      {busyKey === metaId ? <LoaderCircle size={13} className="spin" /> : <Send size={13} />}
      {busyKey === metaId ? 'Đang đẩy' : 'Đẩy CRM'}
    </button>,
    element,
  ));

  const modal = open
    ? createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 100001, display: 'grid', placeItems: 'center', padding: 18, background: 'rgba(20,22,28,.42)' }} onMouseDown={(event) => { if (event.target === event.currentTarget && !busyKey) setOpen(false); }}>
          <section style={{ width: 'min(820px,100%)', maxHeight: '88vh', overflow: 'auto', borderRadius: 18, background: 'white', boxShadow: '0 24px 80px rgba(0,0,0,.24)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', padding: '18px 20px 14px', borderBottom: '1px solid #eceef3' }}>
              <div>
                <strong style={{ fontSize: 18 }}>Đẩy tài nguyên sang CRM</strong>
                <div style={{ marginTop: 4, color: '#6b7079', fontSize: 12 }}>Lọc theo trạng thái rồi đẩy toàn bộ kết quả. Mỗi lô tối đa 100 tài nguyên và được gửi tuần tự.</div>
              </div>
              <button type="button" disabled={Boolean(busyKey)} onClick={() => setOpen(false)} aria-label="Đóng" style={{ border: 0, background: 'transparent', padding: 6 }}><X size={20} /></button>
            </div>

            <div style={{ padding: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 9, marginBottom: 14 }}>
                {[
                  ['Tổng có thể đẩy', counts.all],
                  ['LIVE', counts.live],
                  ['DIE', counts.die],
                  ['Hạn chế', counts.restricted],
                ].map(([label, value]) => <div key={String(label)} style={{ border: '1px solid #e3e5eb', borderRadius: 11, padding: 11 }}><small style={{ color: '#747880' }}>{label}</small><strong style={{ display: 'block', marginTop: 4, fontSize: 20 }}>{value}</strong></div>)}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr .8fr', gap: 9, marginBottom: 12 }}>
                <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 700 }}>
                  Tìm tài nguyên
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên hoặc Meta ID" style={{ border: '1px solid #d9dce3', borderRadius: 9, padding: '10px 11px', font: 'inherit' }} />
                </label>
                <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 700 }}>
                  Trạng thái
                  <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} style={{ border: '1px solid #d9dce3', borderRadius: 9, padding: '10px 11px', font: 'inherit', background: 'white' }}>
                    <option value="ALL">Tất cả</option>
                    <option value="LIVE">LIVE</option>
                    <option value="DIE">DIE</option>
                    <option value="RESTRICTED">Hạn chế</option>
                    <option value="OTHER">Khác / chưa xác định</option>
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 700 }}>
                  Loại
                  <select value={type} onChange={(event) => setType(event.target.value as TypeFilter)} style={{ border: '1px solid #d9dce3', borderRadius: 9, padding: '10px 11px', font: 'inherit', background: 'white' }}>
                    <option value="ALL">Tất cả</option>
                    <option value="BM">Business Manager</option>
                    <option value="TKQC">Tài khoản quảng cáo</option>
                    <option value="Page">Page</option>
                  </select>
                </label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderRadius: 10, background: '#f7f8fb', padding: '10px 12px', marginBottom: 11 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13 }}><Filter size={15} /> Bộ lọc hiện có <strong>{filtered.length}</strong> tài nguyên</span>
                <button type="button" className="button" disabled={loadingAssets || Boolean(busyKey)} onClick={() => void loadAssets()}>Làm mới</button>
              </div>

              {loadingAssets ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 34, color: '#747880' }}><LoaderCircle className="spin" size={18} /> Đang tải danh sách…</div>
              ) : filtered.length ? (
                <div style={{ border: '1px solid #e4e6eb', borderRadius: 11, overflow: 'hidden', marginBottom: 14 }}>
                  <div style={{ maxHeight: 300, overflow: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead><tr style={{ background: '#fafafd', textAlign: 'left' }}><th style={{ padding: 9 }}>Loại</th><th style={{ padding: 9 }}>Tên</th><th style={{ padding: 9 }}>Meta ID</th><th style={{ padding: 9 }}>Trạng thái</th></tr></thead>
                      <tbody>{filtered.slice(0, 100).map((asset) => <tr key={asset.id} style={{ borderTop: '1px solid #eef0f3' }}><td style={{ padding: 9 }}>{asset.type}</td><td style={{ padding: 9, fontWeight: 700 }}>{asset.name}</td><td style={{ padding: 9 }}>{metaIdFromAsset(asset)}</td><td style={{ padding: 9 }}>{asset.status}</td></tr>)}</tbody>
                    </table>
                  </div>
                  {filtered.length > 100 && <div style={{ padding: 9, borderTop: '1px solid #eef0f3', color: '#747880' }}>Đang xem trước 100/{filtered.length} tài nguyên. Khi đẩy, toàn bộ {filtered.length} kết quả sẽ được xử lý.</div>}
                </div>
              ) : (
                <div style={{ border: '1px dashed #d8dbe2', borderRadius: 11, padding: 26, textAlign: 'center', color: '#747880', marginBottom: 14 }}>Không có tài nguyên phù hợp với bộ lọc.</div>
              )}

              {progress && <div style={{ marginBottom: 10, color: '#5b4ab7', fontSize: 13 }}>{progress}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
                <button type="button" className="button" disabled={Boolean(busyKey)} onClick={() => setOpen(false)}>Đóng</button>
                <button type="button" className="button primary" disabled={loadingAssets || Boolean(busyKey) || filtered.length === 0} onClick={() => void pushFiltered()}>
                  {busyKey === 'bulk' ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />}
                  {busyKey === 'bulk' ? 'Đang đẩy…' : `Đẩy ${filtered.length} tài nguyên sang CRM`}
                </button>
              </div>
            </div>
          </section>
        </div>,
        document.body,
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
            zIndex: 100002,
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

  return <>{toolbarButton}{selectionButton}{rowButtons}{modal}{noticePortal}</>;
}
