'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { CopyPlus, Factory, FileSliders, LoaderCircle, Pencil, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';

type Token = { id: string; label: string; status: string; metaUserName?: string };
type PageItem = { id: string; name: string };
type Preset = {
  id: string;
  name: string;
  prefixTemplate: string;
  defaultCount: number;
  interval: number;
  tokenId: string;
  tokenLabel: string;
  pageMode: 'random' | 'fixed';
  primaryPage?: string;
  timezone: number;
  vertical: string;
  adminEmail?: string;
  createdAt: string;
  updatedAt: string;
};

type ApiResponse = {
  presets?: Preset[];
  tokens?: Token[];
  pages?: PageItem[];
  error?: string;
  message?: string;
};

type FormState = {
  id: string;
  name: string;
  prefixTemplate: string;
  defaultCount: number;
  interval: number;
  tokenId: string;
  pageMode: 'random' | 'fixed';
  primaryPage: string;
  timezone: number;
  vertical: string;
  adminEmail: string;
};

const emptyForm: FormState = {
  id: '',
  name: '',
  prefixTemplate: 'BM-{date}',
  defaultCount: 10,
  interval: 30,
  tokenId: '',
  pageMode: 'random',
  primaryPage: '',
  timezone: 1,
  vertical: 'ADVERTISING',
  adminEmail: '',
};

function localDateCode() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function queuePrefix(template: string) {
  return template.replaceAll('{date}', localDateCode()).trim();
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN');
}

export default function ResourcePresetManager() {
  const [navTarget, setNavTarget] = useState<Element | null>(null);
  const [mainTarget, setMainTarget] = useState<Element | null>(null);
  const [active, setActive] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const findTargets = useCallback(() => {
    const navs = document.querySelectorAll('.sidebar nav');
    setNavTarget(navs[1] || navs[0] || null);
    setMainTarget(document.querySelector('.main-wrap'));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [presetResponse, tokenResponse] = await Promise.all([
        fetch('/api/resource-presets', { cache: 'no-store' }),
        fetch('/api/meta-tokens', { cache: 'no-store' }),
      ]);
      const presetData = await presetResponse.json() as ApiResponse;
      const tokenData = await tokenResponse.json() as ApiResponse;
      if (!presetResponse.ok) throw new Error(presetData.error || 'Không tải được preset.');
      if (!tokenResponse.ok) throw new Error(tokenData.error || 'Không tải được token.');
      setPresets(presetData.presets || []);
      setTokens(tokenData.tokens || []);
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
    if (!active) return;
    const timer = window.setTimeout(() => void load(), 0);
    const mains = Array.from(document.querySelectorAll('.main-wrap > main')) as HTMLElement[];
    const hidden = mains.filter((main) => !main.classList.contains('resource-preset-main'));
    const previous = hidden.map((main) => main.style.display);
    hidden.forEach((main) => { main.style.display = 'none'; });
    const breadcrumb = document.querySelector('.breadcrumb strong') as HTMLElement | null;
    const oldBreadcrumb = breadcrumb?.textContent || '';
    if (breadcrumb) breadcrumb.textContent = 'Preset tài nguyên';
    return () => {
      window.clearTimeout(timer);
      hidden.forEach((main, index) => { main.style.display = previous[index] || ''; });
      if (breadcrumb) breadcrumb.textContent = oldBreadcrumb;
    };
  }, [active, load]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!active) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const navButton = target.closest('.nav-item');
      if (navButton && !navButton.hasAttribute('data-resource-preset-nav')) setActive(false);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [active]);

  async function loadPages(tokenId: string) {
    setPages([]);
    if (!tokenId) return;
    try {
      const response = await fetch(`/api/business-manager?tokenId=${encodeURIComponent(tokenId)}`, { cache: 'no-store' });
      const data = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(data.error || 'Không đọc được Page của token.');
      setPages(data.pages || []);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function openNew() {
    const defaultToken = tokens.find((token) => token.status === 'active')?.id || tokens[0]?.id || '';
    setForm({ ...emptyForm, tokenId: defaultToken });
    setPages([]);
    setShowForm(true);
    setMessage('');
    setError('');
  }

  function editPreset(preset: Preset) {
    setForm({
      id: preset.id,
      name: preset.name,
      prefixTemplate: preset.prefixTemplate,
      defaultCount: preset.defaultCount,
      interval: preset.interval,
      tokenId: preset.tokenId,
      pageMode: preset.pageMode,
      primaryPage: preset.primaryPage || '',
      timezone: preset.timezone,
      vertical: preset.vertical,
      adminEmail: preset.adminEmail || '',
    });
    setShowForm(true);
    setMessage('');
    setError('');
    if (preset.pageMode === 'fixed') void loadPages(preset.tokenId);
  }

  async function savePreset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/resource-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', ...form, id: form.id || undefined }),
      });
      const data = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(data.error || 'Không lưu được preset.');
      setShowForm(false);
      setMessage(data.message || 'Đã lưu preset.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function deletePreset(preset: Preset) {
    if (!window.confirm(`Xóa preset “${preset.name}”?`)) return;
    setBusyId(preset.id);
    setError('');
    try {
      const response = await fetch('/api/resource-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: preset.id }),
      });
      const data = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(data.error || 'Không xóa được preset.');
      setMessage(data.message || 'Đã xóa preset.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId('');
    }
  }

  async function createQueue(preset: Preset) {
    setBusyId(preset.id);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/production-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          name: `${preset.name} · ${new Date().toLocaleDateString('vi-VN')}`,
          prefix: queuePrefix(preset.prefixTemplate),
          count: preset.defaultCount,
          interval: preset.interval,
          tokenId: preset.tokenId,
          pageMode: preset.pageMode,
          primaryPage: preset.primaryPage || '',
          timezone: preset.timezone,
          vertical: preset.vertical,
          adminEmail: preset.adminEmail || '',
        }),
      });
      const data = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(data.error || 'Không tạo được hàng đợi từ preset.');
      setMessage(`Đã tạo hàng đợi từ preset “${preset.name}”. Vào Hàng đợi sản xuất để tạo từng BM.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId('');
    }
  }

  const preview = useMemo(() => {
    const prefix = queuePrefix(form.prefixTemplate || 'BM-{date}');
    return `${prefix} 001`;
  }, [form.prefixTemplate]);

  const navPortal = navTarget ? createPortal(
    <button type="button" data-resource-preset-nav className={`nav-item ${active ? 'active' : ''}`} onClick={() => setActive(true)}>
      <FileSliders size={19} />
      <span>Preset tài nguyên</span>
      {presets.length > 0 && <small>{presets.length}</small>}
    </button>,
    navTarget,
  ) : null;

  const panelPortal = active && mainTarget ? createPortal(
    <main className="resource-preset-main" style={{ padding: '32px 36px 50px' }}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">RESOURCE FACTORY</div>
          <h1>Preset tài nguyên</h1>
          <p>Lưu cấu hình thường dùng để tạo hàng đợi BM nhanh mà không phải nhập lại token, Page, timezone và vertical.</p>
        </div>
        <div className="heading-actions">
          <button className="button" type="button" disabled={loading} onClick={() => void load()}><RefreshCw size={16} className={loading ? 'spin' : ''}/>Làm mới</button>
          <button className="button primary" type="button" onClick={openNew}><Plus size={17}/>Tạo preset</button>
        </div>
      </div>

      <div style={{ padding: 12, borderRadius: 9, margin: '18px 0', background: '#f6f3ff', color: '#5f45b7', fontSize: 13 }}>
        Preset chỉ tạo cấu hình và hàng đợi. Nó không tự gửi yêu cầu tạo BM. Mỗi BM vẫn được tạo thủ công từ màn hình Hàng đợi sản xuất.
      </div>
      {message && <div style={{ padding: 11, marginBottom: 12, borderRadius: 8, background: '#eaf8ef', color: '#176b37' }}>{message}</div>}
      {error && <div style={{ padding: 11, marginBottom: 12, borderRadius: 8, background: '#fff0ef', color: '#9c3531' }}>{error}</div>}

      {showForm && <section className="panel" style={{ padding: 20, marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
          <h2 style={{ margin: 0 }}>{form.id ? 'Sửa preset' : 'Tạo preset mới'}</h2>
          <button className="icon-button" type="button" onClick={() => setShowForm(false)} aria-label="Đóng"><X size={19}/></button>
        </div>
        <form onSubmit={savePreset} style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 12 }}>
          <label>Tên preset<input required maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="VD: BM US chuẩn" /></label>
          <label>Mẫu tiền tố tên BM<input required maxLength={80} value={form.prefixTemplate} onChange={(event) => setForm({ ...form, prefixTemplate: event.target.value })} placeholder="VD: US-{date}" /><small className="muted">Dùng {'{date}'} để chèn ngày hiện tại. Ví dụ: {preview}</small></label>
          <label>Số lượng mặc định<input type="number" min={1} max={100} required value={form.defaultCount} onChange={(event) => setForm({ ...form, defaultCount: Number(event.target.value) })} /></label>
          <label>Khoảng nghỉ (giây)<input type="number" min={5} max={3600} required value={form.interval} onChange={(event) => setForm({ ...form, interval: Number(event.target.value) })} /></label>
          <label>Token nguồn<select required value={form.tokenId} onChange={(event) => { const tokenId = event.target.value; setForm({ ...form, tokenId, primaryPage: '' }); if (form.pageMode === 'fixed') void loadPages(tokenId); }}><option value="">Chọn token</option>{tokens.map((token) => <option key={token.id} value={token.id}>{token.label} · {token.status}</option>)}</select></label>
          <label>Page đại diện<select value={form.pageMode} onChange={(event) => { const pageMode = event.target.value as 'random' | 'fixed'; setForm({ ...form, pageMode, primaryPage: '' }); if (pageMode === 'fixed') void loadPages(form.tokenId); }}><option value="random">Ngẫu nhiên từ Page của token</option><option value="fixed">Cố định một Page</option></select></label>
          {form.pageMode === 'fixed' && <label>Page cố định<select required value={form.primaryPage} onChange={(event) => setForm({ ...form, primaryPage: event.target.value })}><option value="">Chọn Page</option>{pages.map((page) => <option key={page.id} value={page.id}>{page.name} · {page.id}</option>)}</select></label>}
          <label>Timezone ID<input type="number" min={1} max={1000} required value={form.timezone} onChange={(event) => setForm({ ...form, timezone: Number(event.target.value) })} /></label>
          <label>Vertical<select value={form.vertical} onChange={(event) => setForm({ ...form, vertical: event.target.value })}><option value="ADVERTISING">Advertising</option><option value="ECOMMERCE">Ecommerce</option><option value="MARKETING">Marketing</option><option value="RETAIL">Retail</option><option value="TECHNOLOGY">Technology</option><option value="OTHER">Other</option></select></label>
          <label>Email admin mặc định<input type="email" maxLength={254} value={form.adminEmail} onChange={(event) => setForm({ ...form, adminEmail: event.target.value })} placeholder="Không bắt buộc" /></label>
          <div style={{ gridColumn: '1/-1', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="button" type="button" onClick={() => setShowForm(false)}>Hủy</button>
            <button className="button primary" disabled={saving || !form.tokenId}>{saving ? <LoaderCircle size={16} className="spin"/> : <Save size={16}/>} {saving ? 'Đang lưu…' : 'Lưu preset'}</button>
          </div>
        </form>
      </section>}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 14 }}>
        {loading && !presets.length ? <div className="panel" style={{ padding: 30, textAlign: 'center' }}>Đang tải preset…</div> : presets.length === 0 ? <div className="panel" style={{ padding: 34, textAlign: 'center' }}><FileSliders size={30}/><h3>Chưa có preset</h3><p className="muted">Tạo preset đầu tiên cho cấu hình BM bạn dùng thường xuyên.</p></div> : presets.map((preset) => {
          const busy = busyId === preset.id;
          return <article className="panel" key={preset.id} style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div><h2 style={{ margin: 0 }}>{preset.name}</h2><p className="muted" style={{ margin: '6px 0 0' }}>Token: {preset.tokenLabel}</p></div>
              <FileSliders size={21}/>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '15px 0', fontSize: 13 }}>
              <span><small className="muted">Tên mẫu</small><strong style={{ display: 'block' }}>{queuePrefix(preset.prefixTemplate)} 001</strong></span>
              <span><small className="muted">Số lượng</small><strong style={{ display: 'block' }}>{preset.defaultCount}</strong></span>
              <span><small className="muted">Khoảng nghỉ</small><strong style={{ display: 'block' }}>{preset.interval}s</strong></span>
              <span><small className="muted">Page</small><strong style={{ display: 'block' }}>{preset.pageMode === 'random' ? 'Ngẫu nhiên' : preset.primaryPage}</strong></span>
              <span><small className="muted">Timezone / Vertical</small><strong style={{ display: 'block' }}>{preset.timezone} · {preset.vertical}</strong></span>
              <span><small className="muted">Cập nhật</small><strong style={{ display: 'block' }}>{formatDate(preset.updatedAt)}</strong></span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="button primary" type="button" disabled={busy} onClick={() => void createQueue(preset)}>{busy ? <LoaderCircle size={16} className="spin"/> : <Factory size={16}/>}Tạo hàng đợi</button>
              <button className="button" type="button" disabled={busy} onClick={() => editPreset(preset)}><Pencil size={16}/>Sửa</button>
              <button className="button" type="button" disabled={busy} onClick={() => { setForm({ ...emptyForm, name: `${preset.name} - bản sao`, prefixTemplate: preset.prefixTemplate, defaultCount: preset.defaultCount, interval: preset.interval, tokenId: preset.tokenId, pageMode: preset.pageMode, primaryPage: preset.primaryPage || '', timezone: preset.timezone, vertical: preset.vertical, adminEmail: preset.adminEmail || '' }); setShowForm(true); if (preset.pageMode === 'fixed') void loadPages(preset.tokenId); }}><CopyPlus size={16}/>Nhân bản</button>
              <button className="button" type="button" disabled={busy} onClick={() => void deletePreset(preset)}><Trash2 size={16}/>Xóa</button>
            </div>
          </article>;
        })}
      </section>
    </main>,
    mainTarget,
  ) : null;

  return <>{navPortal}{panelPortal}</>;
}
