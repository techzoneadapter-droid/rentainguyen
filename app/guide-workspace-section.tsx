'use client';

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  FileUp,
  LoaderCircle,
  RefreshCw,
  Search,
  Send,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';

type GuideAsset = {
  id: string;
  title: string;
  category: string;
  summary: string;
  price: number;
  fileName: string;
  fileSize: number;
  contentType: string;
  storageBucket: string;
  storagePath: string;
  publicUrl: string;
  created: string;
  crmPushStatus?: string;
  crmPushAt?: string;
  crmGuideId?: string;
  crmGuideCode?: string;
  crmPushError?: string;
};

type ListResponse = { guides?: GuideAsset[]; error?: string };
type ActionResponse = {
  guide?: GuideAsset;
  message?: string;
  error?: string;
  signedUploadUrl?: string;
  storageBucket?: string;
  storagePath?: string;
  publicUrl?: string;
  accepted?: Array<{ local_id: string }>;
  rejected?: Array<{ local_id?: string; error: string }>;
};

type FilterStatus = 'all' | 'unpushed' | 'pushed' | 'error';

const MAX_FILE_SIZE = 200 * 1024 * 1024;

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatDate(value?: string) {
  if (!value) return 'Chưa có';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
}

function statusTone(value?: string) {
  if (value === 'Đã đẩy') return { label: 'Đã đẩy', bg: '#eaf8ef', color: '#176b37' };
  if (value === 'Lỗi') return { label: 'Lỗi', bg: '#fff0ef', color: '#a13a35' };
  return { label: 'Chưa đẩy', bg: '#f1f2f5', color: '#555b66' };
}

async function uploadToSignedUrl(url: string, file: File) {
  const form = new FormData();
  form.append('cacheControl', '3600');
  form.append('', file);
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'x-upsert': 'false' },
    body: form,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Không tải được tệp lên kho lưu trữ${text ? `: ${text.slice(0, 180)}` : '.'}`);
  }
}

export default function GuideWorkspaceSection() {
  const [navTarget, setNavTarget] = useState<Element | null>(null);
  const [mainTarget, setMainTarget] = useState<Element | null>(null);
  const [active, setActive] = useState(false);
  const [guides, setGuides] = useState<GuideAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<FilterStatus>('all');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const findTargets = useCallback(() => {
    const navs = document.querySelectorAll('.sidebar nav');
    setNavTarget(navs[0] || null);
    setMainTarget(document.querySelector('.main-wrap'));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/guides', { cache: 'no-store' });
      const data = (await response.json()) as ListResponse;
      if (!response.ok) throw new Error(data.error || 'Không tải được danh sách bí kíp.');
      setGuides(data.guides || []);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(findTargets, 0);
    const observer = new MutationObserver(findTargets);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [findTargets]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!active) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const navButton = target.closest('.nav-item');
      if (navButton && !navButton.hasAttribute('data-guide-workspace-nav')) setActive(false);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [active]);

  useEffect(() => {
    const originalMain = document.querySelector('.main-wrap > main:not(.guide-workspace-main):not(.token-workspace-main)') as HTMLElement | null;
    const breadcrumb = document.querySelector('.breadcrumb strong') as HTMLElement | null;
    if (!active) return;

    const oldDisplay = originalMain?.style.display || '';
    const oldBreadcrumb = breadcrumb?.textContent || '';
    if (originalMain) originalMain.style.display = 'none';
    if (breadcrumb) breadcrumb.textContent = 'Bí kíp';
    const timer = window.setTimeout(() => void load(), 0);

    return () => {
      window.clearTimeout(timer);
      if (originalMain) originalMain.style.display = oldDisplay;
      if (breadcrumb) breadcrumb.textContent = oldBreadcrumb;
    };
  }, [active, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return guides.filter((guide) => {
      if (q && !`${guide.title} ${guide.category} ${guide.fileName}`.toLowerCase().includes(q)) return false;
      if (status === 'pushed' && guide.crmPushStatus !== 'Đã đẩy') return false;
      if (status === 'error' && guide.crmPushStatus !== 'Lỗi') return false;
      if (status === 'unpushed' && guide.crmPushStatus === 'Đã đẩy') return false;
      return true;
    });
  }, [guides, query, status]);

  const counts = useMemo(() => ({
    total: guides.length,
    pushed: guides.filter((guide) => guide.crmPushStatus === 'Đã đẩy').length,
    pending: guides.filter((guide) => guide.crmPushStatus !== 'Đã đẩy').length,
  }), [guides]);

  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get('file');
    if (!(file instanceof File) || !file.size) {
      setError('Chọn một tệp để tải lên.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('Tệp vượt quá giới hạn 200 MB.');
      return;
    }

    setUploading(true);
    try {
      const prepareResponse = await fetch('/api/guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'prepare_upload',
          fileName: file.name,
          fileSize: file.size,
          contentType: file.type || 'application/octet-stream',
        }),
      });
      const prepared = (await prepareResponse.json()) as ActionResponse;
      if (!prepareResponse.ok || !prepared.signedUploadUrl || !prepared.storagePath || !prepared.storageBucket || !prepared.publicUrl) {
        throw new Error(prepared.error || 'Không tạo được phiên tải tệp.');
      }

      await uploadToSignedUrl(prepared.signedUploadUrl, file);

      const saveResponse = await fetch('/api/guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          title: String(data.get('title') || file.name.replace(/\.[^.]+$/, '')),
          category: String(data.get('category') || 'Khác'),
          summary: String(data.get('summary') || ''),
          price: Number(data.get('price') || 0),
          fileName: file.name,
          fileSize: file.size,
          contentType: file.type || 'application/octet-stream',
          storageBucket: prepared.storageBucket,
          storagePath: prepared.storagePath,
          publicUrl: prepared.publicUrl,
        }),
      });
      const saved = (await saveResponse.json()) as ActionResponse;
      if (!saveResponse.ok) throw new Error(saved.error || 'Tệp đã tải lên nhưng không lưu được hồ sơ bí kíp.');

      form.reset();
      setShowUpload(false);
      setMessage(saved.message || 'Đã thêm bí kíp.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function runAction(action: 'push' | 'delete', ids: string[]) {
    if (!ids.length) {
      setError('Chọn ít nhất một bí kíp.');
      return;
    }
    if (action === 'delete' && !window.confirm(`Xóa ${ids.length} bí kíp khỏi workspace? Tệp đã tải lên sẽ không bị xóa khỏi kho CRM.`)) return;

    const key = ids.length === 1 ? ids[0] : action;
    setBusyId(key);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids }),
      });
      const data = (await response.json()) as ActionResponse;
      if (!response.ok) throw new Error(data.error || `Không ${action === 'push' ? 'đẩy' : 'xóa'} được bí kíp.`);
      const rejected = data.rejected?.length || 0;
      setMessage(data.message || (rejected ? `Đã xử lý, có ${rejected} mục lỗi.` : 'Đã xử lý xong.'));
      setSelected([]);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId('');
    }
  }

  const navPortal = navTarget
    ? createPortal(
        <button
          type="button"
          data-guide-workspace-nav
          className={`nav-item ${active ? 'active' : ''}`}
          onClick={() => setActive(true)}
        >
          <BookOpen size={19} />
          <span>Bí kíp</span>
          {guides.length > 0 && <small>{guides.length}</small>}
        </button>,
        navTarget,
      )
    : null;

  const panelPortal = active && mainTarget
    ? createPortal(
        <main className="guide-workspace-main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">DIGITAL RESOURCE LIBRARY</div>
              <h1>Bí kíp</h1>
              <p>Tải tệp thủ công, quản lý trong workspace và đẩy sang Kho Bí Kíp của CRM khi sẵn sàng.</p>
            </div>
            <div className="heading-actions">
              <button className="button" type="button" disabled={loading} onClick={() => void load()}>
                <RefreshCw size={16} className={loading ? 'spin' : ''} /> Làm mới
              </button>
              <button className="button primary" type="button" onClick={() => setShowUpload(true)}>
                <FileUp size={17} /> Thêm bí kíp
              </button>
            </div>
          </div>

          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 16, marginBottom: 22 }}>
            {[
              ['Tổng bí kíp', counts.total],
              ['Đã đẩy CRM', counts.pushed],
              ['Chưa đẩy / cần xử lý', counts.pending],
            ].map(([label, value]) => (
              <div className="panel" key={String(label)} style={{ padding: 18 }}>
                <small className="muted">{label}</small>
                <strong style={{ display: 'block', fontSize: 30, marginTop: 7 }}>{value}</strong>
              </div>
            ))}
          </section>

          {message && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 11, marginBottom: 12, borderRadius: 8, background: '#eaf8ef', color: '#176b37' }}>
              <CheckCircle2 size={17} /> {message}
            </div>
          )}
          {error && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 11, marginBottom: 12, borderRadius: 8, background: '#fff0ef', color: '#9c3531' }}>
              <AlertTriangle size={17} style={{ marginTop: 2 }} /> {error}
            </div>
          )}

          <section className="panel" style={{ marginBottom: 30 }}>
            <div className="panel-heading" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div>
                <h2>Kho bí kíp trong workspace</h2>
                <small className="muted">Tệp mới chỉ xuất hiện trong CRM sau khi bạn bấm Đẩy sang CRM.</small>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="button" type="button" disabled={!selected.length || Boolean(busyId)} onClick={() => void runAction('push', selected)}>
                  {busyId === 'push' ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />}
                  Đẩy đã chọn ({selected.length})
                </button>
                <button className="button" type="button" disabled={!selected.length || Boolean(busyId)} onClick={() => void runAction('delete', selected)}>
                  <Trash2 size={15} /> Xóa đã chọn
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px,1fr) 220px', gap: 10, padding: '0 18px 14px' }}>
              <label className="search-input">
                <Search size={17} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm theo tên, chủ đề hoặc tên tệp..." />
                {query && <button type="button" className="icon-button" onClick={() => setQuery('')} aria-label="Xóa tìm kiếm"><X size={14} /></button>}
              </label>
              <select value={status} onChange={(event) => setStatus(event.target.value as FilterStatus)}>
                <option value="all">Tất cả trạng thái CRM</option>
                <option value="unpushed">Chưa đẩy / cần xử lý</option>
                <option value="pushed">Đã đẩy</option>
                <option value="error">Lỗi</option>
              </select>
            </div>

            {loading && !guides.length ? (
              <div style={{ padding: 34, textAlign: 'center' }} className="muted"><LoaderCircle size={20} className="spin" style={{ marginRight: 7 }} /> Đang tải…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 42, textAlign: 'center' }}>
                <BookOpen size={32} style={{ margin: '0 auto 9px', color: '#8b79df' }} />
                <h3 style={{ margin: '0 0 6px' }}>{guides.length ? 'Không có bí kíp phù hợp bộ lọc' : 'Chưa có bí kíp'}</h3>
                <p className="muted" style={{ margin: 0 }}>Bấm “Thêm bí kíp” để tải tệp text, cấu hình hoặc tệp cài đặt lên workspace.</p>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Chọn tất cả bí kíp đang hiển thị"
                          checked={filtered.length > 0 && filtered.every((guide) => selected.includes(guide.id))}
                          onChange={(event) => {
                            const visible = filtered.map((guide) => guide.id);
                            setSelected(event.target.checked ? Array.from(new Set([...selected, ...visible])) : selected.filter((id) => !visible.includes(id)));
                          }}
                        />
                      </th>
                      <th>Bí kíp / tệp</th>
                      <th>Chủ đề</th>
                      <th>Giá</th>
                      <th>CRM</th>
                      <th>Ngày thêm</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((guide) => {
                      const tone = statusTone(guide.crmPushStatus);
                      return (
                        <tr key={guide.id} className={selected.includes(guide.id) ? 'row-selected' : ''}>
                          <td><input type="checkbox" checked={selected.includes(guide.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, guide.id] : selected.filter((id) => id !== guide.id))} aria-label={`Chọn ${guide.title}`} /></td>
                          <td style={{ minWidth: 280 }}>
                            <strong style={{ display: 'block' }}>{guide.title}</strong>
                            <small className="muted" style={{ display: 'block', marginTop: 4 }}>{guide.fileName} · {formatBytes(guide.fileSize)}</small>
                            {guide.summary && <small className="muted" style={{ display: 'block', marginTop: 3, maxWidth: 420, whiteSpace: 'normal' }}>{guide.summary}</small>}
                          </td>
                          <td>{guide.category || 'Khác'}</td>
                          <td>{formatMoney(guide.price)}</td>
                          <td style={{ maxWidth: 260, whiteSpace: 'normal' }}>
                            <span style={{ display: 'inline-block', padding: '5px 8px', borderRadius: 999, background: tone.bg, color: tone.color, fontWeight: 600 }}>{tone.label}</span>
                            {guide.crmGuideCode && <small className="muted" style={{ display: 'block', marginTop: 4 }}>{guide.crmGuideCode}</small>}
                            {guide.crmPushError && <small style={{ display: 'block', marginTop: 4, color: '#a13a35' }}>{guide.crmPushError}</small>}
                          </td>
                          <td>{formatDate(guide.created)}</td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button className="button compact" type="button" disabled={Boolean(busyId)} onClick={() => void runAction('push', [guide.id])}>
                                {busyId === guide.id ? <LoaderCircle size={13} className="spin" /> : <Send size={13} />} Đẩy CRM
                              </button>
                              <button className="button compact" type="button" disabled={Boolean(busyId)} onClick={() => void runAction('delete', [guide.id])}>
                                <Trash2 size={13} /> Xóa
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {showUpload && createPortal(
            <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !uploading) setShowUpload(false); }} style={{ position: 'fixed', inset: 0, zIndex: 150, display: 'grid', placeItems: 'center', padding: 18, background: 'rgba(20,22,28,.42)', backdropFilter: 'blur(2px)' }}>
              <section role="dialog" aria-modal="true" aria-label="Thêm bí kíp" style={{ width: 'min(640px,100%)', maxHeight: '90vh', overflow: 'auto', borderRadius: 18, background: 'white', boxShadow: '0 24px 80px rgba(0,0,0,.25)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '18px 20px 14px', borderBottom: '1px solid #eceef3' }}>
                  <div style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
                    <span className="stat-icon tone-0"><UploadCloud size={19} /></span>
                    <div><strong style={{ display: 'block', fontSize: 18 }}>Thêm bí kíp</strong><small className="muted">Tải tệp lên thủ công, tối đa 200 MB.</small></div>
                  </div>
                  <button className="icon-button" type="button" disabled={uploading} onClick={() => setShowUpload(false)} aria-label="Đóng"><X size={19} /></button>
                </div>
                <form ref={formRef} onSubmit={submitUpload} style={{ padding: 20 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label style={{ gridColumn: '1 / -1' }}><span style={{ display: 'block', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Tên bí kíp</span><input name="title" required minLength={2} maxLength={180} placeholder="VD: Bộ cấu hình quảng cáo mẫu" style={{ width: '100%' }} /></label>
                    <label><span style={{ display: 'block', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Chủ đề</span><input name="category" maxLength={80} defaultValue="Khác" placeholder="Quảng cáo, Tool, Cài đặt..." style={{ width: '100%' }} /></label>
                    <label><span style={{ display: 'block', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Giá dự kiến</span><input name="price" type="number" min={0} step={1000} defaultValue={0} style={{ width: '100%' }} /></label>
                    <label style={{ gridColumn: '1 / -1' }}><span style={{ display: 'block', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Mô tả ngắn</span><textarea name="summary" maxLength={1200} rows={3} placeholder="Mô tả nội dung tệp để dễ quản lý trong CRM." style={{ width: '100%', resize: 'vertical' }} /></label>
                    <label style={{ gridColumn: '1 / -1' }}>
                      <span style={{ display: 'block', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Tệp bí kíp</span>
                      <input name="file" type="file" required style={{ width: '100%', border: '1px dashed #cfd3de', borderRadius: 10, padding: 14, background: '#fafafd' }} />
                      <small className="muted" style={{ display: 'block', marginTop: 7, lineHeight: 1.5 }}>Có thể tải TXT, JSON, cấu hình, ZIP hoặc tệp cài đặt. App không tự chạy hay mở tệp; chỉ lưu để bàn giao qua CRM.</small>
                    </label>
                  </div>
                  <div style={{ marginTop: 14, padding: 10, borderRadius: 9, background: '#f8f6ff', color: '#62558d', fontSize: 12, lineHeight: 1.5 }}>Sau khi tải lên, bí kíp chỉ nằm trong workspace. Bạn chủ động bấm <strong>Đẩy CRM</strong>; phía CRM nhận ở trạng thái <strong>DRAFT</strong> để kiểm tra trước khi đưa lên Shop.</div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 16 }}>
                    <button className="button" type="button" disabled={uploading} onClick={() => setShowUpload(false)}>Hủy</button>
                    <button className="button primary" disabled={uploading}>
                      {uploading ? <LoaderCircle size={16} className="spin" /> : <UploadCloud size={16} />}
                      {uploading ? 'Đang tải tệp…' : 'Tải lên workspace'}
                    </button>
                  </div>
                </form>
              </section>
            </div>,
            document.body,
          )}
        </main>,
        mainTarget,
      )
    : null;

  return <>{navPortal}{panelPortal}</>;
}
