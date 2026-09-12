'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Boxes, RefreshCw, Search, ShieldCheck, UploadCloud } from 'lucide-react';

type HealthStatus = 'LIVE' | 'DIE' | 'RESTRICTED' | 'UNKNOWN' | 'N/A';
type LifecycleStatus = 'NEW' | 'CHECKING' | 'READY' | 'PUSHED';

type ResourceRow = {
  key: string;
  id: string;
  metaId?: string;
  name: string;
  type: 'BM' | 'TKQC' | 'Page' | 'Dataset/Pixel' | 'Bí kíp';
  health: HealthStatus;
  lifecycle: LifecycleStatus;
  source: string;
  sourceLabel: string;
  sourceToken?: string;
  createdAt?: string;
  checkedAt?: string;
  crmPushAt?: string;
  crmPushStatus?: string;
  lastError?: string;
  verified?: boolean;
  tier?: string;
};

type ApiResponse = {
  resources?: ResourceRow[];
  error?: string;
};

const healthLabel: Record<HealthStatus, string> = {
  LIVE: 'LIVE',
  DIE: 'DIE',
  RESTRICTED: 'Hạn chế',
  UNKNOWN: 'Chưa xác định',
  'N/A': 'Không áp dụng',
};

const lifecycleLabel: Record<LifecycleStatus, string> = {
  NEW: 'Mới tạo',
  CHECKING: 'Đang kiểm tra',
  READY: 'Sẵn sàng',
  PUSHED: 'Đã đẩy CRM',
};

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN');
}

function badgeTone(value: string) {
  if (value === 'LIVE' || value === 'READY' || value === 'PUSHED') return { background: '#eaf8ef', color: '#176b37' };
  if (value === 'DIE') return { background: '#fff0ef', color: '#a13a35' };
  if (value === 'RESTRICTED' || value === 'CHECKING') return { background: '#fff7e5', color: '#8a5d00' };
  return { background: '#f1f2f5', color: '#555b66' };
}

export default function ResourceCenter() {
  const [navTarget, setNavTarget] = useState<Element | null>(null);
  const [mainTarget, setMainTarget] = useState<Element | null>(null);
  const [active, setActive] = useState(false);
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('ALL');
  const [health, setHealth] = useState('ALL');
  const [lifecycle, setLifecycle] = useState('ALL');

  const findTargets = useCallback(() => {
    const navs = document.querySelectorAll('.sidebar nav');
    setNavTarget(navs[0] || null);
    setMainTarget(document.querySelector('.main-wrap'));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/resource-center', { cache: 'no-store' });
      const data = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(data.error || 'Không tải được trung tâm tài nguyên.');
      setResources(data.resources || []);
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
    const hidden = mains.filter((main) => !main.classList.contains('resource-center-main'));
    const previous = hidden.map((main) => main.style.display);
    hidden.forEach((main) => { main.style.display = 'none'; });
    const breadcrumb = document.querySelector('.breadcrumb strong') as HTMLElement | null;
    const oldBreadcrumb = breadcrumb?.textContent || '';
    if (breadcrumb) breadcrumb.textContent = 'Trung tâm tài nguyên';
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
      if (navButton && !navButton.hasAttribute('data-resource-center-nav')) setActive(false);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [active]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return resources.filter((resource) => {
      if (type !== 'ALL' && resource.type !== type) return false;
      if (health !== 'ALL' && resource.health !== health) return false;
      if (lifecycle !== 'ALL' && resource.lifecycle !== lifecycle) return false;
      if (!needle) return true;
      return `${resource.name} ${resource.metaId || resource.id} ${resource.sourceLabel} ${resource.sourceToken || ''}`.toLowerCase().includes(needle);
    });
  }, [resources, query, type, health, lifecycle]);

  const stats = useMemo(() => ({
    total: resources.length,
    live: resources.filter((item) => item.health === 'LIVE').length,
    attention: resources.filter((item) => ['DIE', 'RESTRICTED', 'UNKNOWN'].includes(item.health)).length,
    ready: resources.filter((item) => item.lifecycle === 'READY').length,
    pushed: resources.filter((item) => item.lifecycle === 'PUSHED').length,
  }), [resources]);

  const navPortal = navTarget ? createPortal(
    <button
      type="button"
      data-resource-center-nav
      className={`nav-item ${active ? 'active' : ''}`}
      onClick={() => setActive(true)}
    >
      <Boxes size={19} />
      <span>Trung tâm tài nguyên</span>
      {resources.length > 0 && <small>{resources.length}</small>}
    </button>,
    navTarget,
  ) : null;

  const panelPortal = active && mainTarget ? createPortal(
    <main className="resource-center-main" style={{ padding: '32px 36px 50px' }}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">RESOURCE FACTORY</div>
          <h1>Trung tâm tài nguyên</h1>
          <p>Kho vận hành thống nhất cho BM, tài khoản quảng cáo, Page, Dataset/Pixel và Bí kíp.</p>
        </div>
        <div className="heading-actions">
          <button className="button" type="button" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} /> Làm mới
          </button>
        </div>
      </div>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: 12, margin: '20px 0' }}>
        {[
          ['Tổng tài nguyên', stats.total],
          ['LIVE', stats.live],
          ['Cần chú ý', stats.attention],
          ['Sẵn sàng', stats.ready],
          ['Đã đẩy CRM', stats.pushed],
        ].map(([label, value]) => (
          <div className="panel" key={String(label)} style={{ padding: 16 }}>
            <small className="muted">{label}</small>
            <strong style={{ display: 'block', fontSize: 27, marginTop: 6 }}>{value}</strong>
          </div>
        ))}
      </section>

      <section className="panel" style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px,1fr) repeat(3,minmax(150px,190px))', gap: 10 }}>
          <label style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: 12, color: '#8d93a1' }} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên, Meta ID, nguồn hoặc token..." style={{ paddingLeft: 36, width: '100%' }} />
          </label>
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="ALL">Tất cả loại</option>
            <option value="BM">Business Manager</option>
            <option value="TKQC">Tài khoản quảng cáo</option>
            <option value="Page">Page</option>
            <option value="Dataset/Pixel">Dataset / Pixel</option>
            <option value="Bí kíp">Bí kíp</option>
          </select>
          <select value={health} onChange={(event) => setHealth(event.target.value)}>
            <option value="ALL">Tất cả sức khỏe</option>
            <option value="LIVE">LIVE</option>
            <option value="DIE">DIE</option>
            <option value="RESTRICTED">Hạn chế</option>
            <option value="UNKNOWN">Chưa xác định</option>
            <option value="N/A">Không áp dụng</option>
          </select>
          <select value={lifecycle} onChange={(event) => setLifecycle(event.target.value)}>
            <option value="ALL">Tất cả vòng đời</option>
            <option value="NEW">Mới tạo</option>
            <option value="CHECKING">Đang kiểm tra</option>
            <option value="READY">Sẵn sàng</option>
            <option value="PUSHED">Đã đẩy CRM</option>
          </select>
        </div>
      </section>

      {error && <div style={{ padding: 12, marginBottom: 14, borderRadius: 9, background: '#fff0ef', color: '#9c3531' }}>{error}</div>}

      <section className="panel">
        <div className="panel-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2>Danh sách tài nguyên</h2>
            <small className="muted">Hiển thị {filtered.length}/{resources.length} tài nguyên</small>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#6d7280', fontSize: 12 }}>
            <ShieldCheck size={16} /> Trạng thái được chuẩn hóa, không thay đổi dữ liệu Meta gốc
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Tài nguyên</th>
                <th>Loại</th>
                <th>Sức khỏe</th>
                <th>Vòng đời</th>
                <th>Nguồn / token</th>
                <th>Tạo lúc</th>
                <th>Kiểm tra gần nhất</th>
                <th>CRM</th>
              </tr>
            </thead>
            <tbody>
              {loading && !resources.length ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 30 }} className="muted">Đang tải tài nguyên…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 34 }} className="muted">Không có tài nguyên phù hợp bộ lọc.</td></tr>
              ) : filtered.map((resource) => {
                const healthTone = badgeTone(resource.health);
                const lifecycleTone = badgeTone(resource.lifecycle);
                return (
                  <tr key={resource.key}>
                    <td style={{ minWidth: 230 }}>
                      <strong style={{ display: 'block' }}>{resource.name}</strong>
                      <small className="muted">{resource.metaId || resource.id}</small>
                      {resource.lastError && <small style={{ display: 'block', color: '#a13a35', marginTop: 4, maxWidth: 360 }}>{resource.lastError}</small>}
                    </td>
                    <td>{resource.type}</td>
                    <td><span style={{ display: 'inline-block', padding: '5px 9px', borderRadius: 999, fontWeight: 700, ...healthTone }}>{healthLabel[resource.health]}</span></td>
                    <td><span style={{ display: 'inline-block', padding: '5px 9px', borderRadius: 999, fontWeight: 700, ...lifecycleTone }}>{lifecycleLabel[resource.lifecycle]}</span></td>
                    <td style={{ minWidth: 180 }}>
                      <span style={{ display: 'block' }}>{resource.sourceLabel}</span>
                      <small className="muted">{resource.sourceToken || '—'}</small>
                    </td>
                    <td>{formatDate(resource.createdAt)}</td>
                    <td>{formatDate(resource.checkedAt)}</td>
                    <td style={{ minWidth: 150 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><UploadCloud size={15} />{resource.crmPushStatus || 'Chưa đẩy'}</span>
                      <small className="muted">{formatDate(resource.crmPushAt)}</small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>,
    mainTarget,
  ) : null;

  return <>{navPortal}{panelPortal}</>;
}
