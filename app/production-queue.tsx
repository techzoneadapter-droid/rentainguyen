'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Clock3, Factory, LoaderCircle, Pause, Play, Plus, RefreshCw, RotateCcw, XCircle } from 'lucide-react';

type Token = { id: string; label: string; status: string; metaUserName?: string };
type PageItem = { id: string; name: string };
type QueueItem = { index: number; name: string; status: 'PENDING' | 'SUCCESS' | 'FAILED'; businessId?: string; pageId?: string; message?: string; finishedAt?: string };
type Queue = {
  id: string;
  name: string;
  prefix: string;
  count: number;
  interval: number;
  tokenId: string;
  tokenLabel: string;
  pageMode: 'random' | 'fixed';
  primaryPage?: string;
  timezone: number;
  vertical: string;
  adminEmail?: string;
  status: 'READY' | 'PAUSED' | 'PAUSED_ERROR' | 'COMPLETED' | 'CANCELLED';
  completed: number;
  failed: number;
  nextAvailableAt: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  items: QueueItem[];
};

type ApiResponse = { queues?: Queue[]; tokens?: Token[]; pages?: PageItem[]; queue?: Queue; error?: string; message?: string };

function statusLabel(status: Queue['status']) {
  if (status === 'READY') return 'Sẵn sàng';
  if (status === 'PAUSED') return 'Tạm dừng';
  if (status === 'PAUSED_ERROR') return 'Dừng do lỗi';
  if (status === 'COMPLETED') return 'Hoàn tất';
  return 'Đã hủy';
}

function statusTone(status: Queue['status']) {
  if (status === 'READY' || status === 'COMPLETED') return { background: '#eaf8ef', color: '#176b37' };
  if (status === 'PAUSED_ERROR') return { background: '#fff0ef', color: '#a13a35' };
  if (status === 'PAUSED') return { background: '#fff7e5', color: '#8a5d00' };
  return { background: '#f1f2f5', color: '#555b66' };
}

export default function ProductionQueue() {
  const [navTarget, setNavTarget] = useState<Element | null>(null);
  const [mainTarget, setMainTarget] = useState<Element | null>(null);
  const [active, setActive] = useState(false);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [pageMode, setPageMode] = useState<'random' | 'fixed'>('random');
  const [formTokenId, setFormTokenId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(0);

  const findTargets = useCallback(() => {
    const navs = document.querySelectorAll('.sidebar nav');
    setNavTarget(navs[1] || navs[0] || null);
    setMainTarget(document.querySelector('.main-wrap'));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [queueResponse, tokenResponse] = await Promise.all([
        fetch('/api/production-queue', { cache: 'no-store' }),
        fetch('/api/meta-tokens', { cache: 'no-store' }),
      ]);
      const queueData = await queueResponse.json() as ApiResponse;
      const tokenData = await tokenResponse.json() as ApiResponse;
      if (!queueResponse.ok) throw new Error(queueData.error || 'Không tải được hàng đợi.');
      if (!tokenResponse.ok) throw new Error(tokenData.error || 'Không tải được token.');
      setQueues(queueData.queues || []);
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
    return () => { window.clearTimeout(timer); observer.disconnect(); };
  }, [findTargets]);

  useEffect(() => {
    const update = () => setNow(Date.now());
    const kickoff = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 1000);
    return () => { window.clearTimeout(kickoff); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => void load(), 0);
    const mains = Array.from(document.querySelectorAll('.main-wrap > main')) as HTMLElement[];
    const hidden = mains.filter((main) => !main.classList.contains('production-queue-main'));
    const previous = hidden.map((main) => main.style.display);
    hidden.forEach((main) => { main.style.display = 'none'; });
    const breadcrumb = document.querySelector('.breadcrumb strong') as HTMLElement | null;
    const oldBreadcrumb = breadcrumb?.textContent || '';
    if (breadcrumb) breadcrumb.textContent = 'Hàng đợi sản xuất';
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
      if (navButton && !navButton.hasAttribute('data-production-queue-nav')) setActive(false);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [active]);

  const activeCount = useMemo(() => queues.filter((queue) => ['READY', 'PAUSED', 'PAUSED_ERROR'].includes(queue.status)).length, [queues]);

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

  function openCreate() {
    setShowCreate(true);
    setPageMode('random');
    setFormTokenId(tokens.find((token) => token.status === 'active')?.id || tokens[0]?.id || '');
    setPages([]);
    setMessage('');
    setError('');
  }

  async function submitQueue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError('');
    setMessage('');
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch('/api/production-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          name: String(data.get('name') || ''),
          prefix: String(data.get('prefix') || ''),
          count: Number(data.get('count') || 1),
          interval: Number(data.get('interval') || 30),
          tokenId: String(data.get('tokenId') || ''),
          pageMode,
          primaryPage: String(data.get('primaryPage') || ''),
          timezone: Number(data.get('timezone') || 1),
          vertical: String(data.get('vertical') || 'ADVERTISING'),
          adminEmail: String(data.get('adminEmail') || ''),
        }),
      });
      const result = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(result.error || 'Không tạo được hàng đợi.');
      setShowCreate(false);
      setMessage(result.message || 'Đã tạo hàng đợi.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function queueAction(queue: Queue, action: 'pause' | 'resume' | 'cancel' | 'retry_failed') {
    setBusyId(queue.id);
    setError('');
    try {
      const response = await fetch('/api/production-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id: queue.id }),
      });
      const data = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(data.error || 'Không cập nhật được hàng đợi.');
      setMessage(data.message || 'Đã cập nhật hàng đợi.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId('');
    }
  }

  function randomPage(list: PageItem[]) {
    if (!list.length) return null;
    const bytes = crypto.getRandomValues(new Uint32Array(1));
    return list[Math.floor((bytes[0] / 4294967296) * list.length)] || list[0];
  }

  async function createNext(queue: Queue) {
    const pending = queue.items.find((item) => item.status === 'PENDING');
    if (!pending) return;
    const wait = Math.max(0, Math.ceil((queue.nextAvailableAt - now) / 1000));
    if (wait > 0) {
      setError(`Hàng đợi đang chờ khoảng nghỉ. Còn ${wait} giây.`);
      return;
    }

    setBusyId(queue.id);
    setError('');
    setMessage('');
    let pageId = queue.primaryPage || '';
    try {
      if (queue.pageMode === 'random') {
        const pageResponse = await fetch(`/api/business-manager?tokenId=${encodeURIComponent(queue.tokenId)}`, { cache: 'no-store' });
        const pageData = await pageResponse.json() as ApiResponse;
        if (!pageResponse.ok) throw new Error(pageData.error || 'Không đọc được Page của token nguồn.');
        const picked = randomPage(pageData.pages || []);
        if (!picked) throw new Error('Token nguồn không có Page hợp lệ để tạo Business Manager.');
        pageId = picked.id;
      }

      const response = await fetch('/api/business-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId: queue.tokenId,
          name: pending.name,
          primaryPage: pageId,
          timezone: queue.timezone,
          vertical: queue.vertical,
          adminEmail: queue.adminEmail || '',
          purposeConfirmed: true,
        }),
      });
      const result = await response.json() as { id?: string; message?: string; error?: string };
      if (!response.ok) throw new Error(result.error || 'Meta không tạo được Business Manager.');

      const record = await fetch('/api/production-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'record_result', id: queue.id, index: pending.index, success: true, businessId: result.id || '', pageId, message: result.message || '' }),
      });
      const recordData = await record.json() as ApiResponse;
      if (!record.ok) throw new Error(recordData.error || 'BM đã tạo nhưng chưa ghi được tiến trình hàng đợi.');
      setMessage(`Đã tạo ${pending.name}${result.id ? ` · ID ${result.id}` : ''}.`);
      await load();
    } catch (err) {
      const reason = (err as Error).message;
      try {
        await fetch('/api/production-queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'record_result', id: queue.id, index: pending.index, success: false, pageId, message: reason }),
        });
      } catch {}
      setError(`${pending.name}: ${reason}`);
      await load();
    } finally {
      setBusyId('');
    }
  }

  const navPortal = navTarget ? createPortal(
    <button type="button" data-production-queue-nav className={`nav-item ${active ? 'active' : ''}`} onClick={() => setActive(true)}>
      <Factory size={19} /><span>Hàng đợi sản xuất</span>{activeCount > 0 && <small>{activeCount}</small>}
    </button>, navTarget,
  ) : null;

  const panelPortal = active && mainTarget ? createPortal(
    <main className="production-queue-main" style={{ padding: '32px 36px 50px' }}>
      <div className="page-heading">
        <div><div className="eyebrow">RESOURCE FACTORY</div><h1>Hàng đợi sản xuất</h1><p>Chuẩn bị trước nhiều BM, theo dõi tiến trình và tạo từng mục bằng một thao tác thủ công.</p></div>
        <div className="heading-actions">
          <button className="button" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''}/>Làm mới</button>
          <button className="button primary" type="button" onClick={openCreate}><Plus size={17}/>Tạo hàng đợi</button>
        </div>
      </div>

      <div style={{ padding: 12, borderRadius: 9, margin: '18px 0', background: '#f6f3ff', color: '#5f45b7', fontSize: 13 }}>
        Hàng đợi không tự chạy nền: mỗi lần bấm “Tạo mục tiếp theo” chỉ gửi đúng 1 yêu cầu tạo BM bằng token đã chọn. Nếu Meta báo lỗi, giới hạn hoặc rate limit, hàng đợi dừng để bạn kiểm tra; không tự đổi token và không tự retry.
      </div>
      {message && <div style={{ padding: 11, marginBottom: 12, borderRadius: 8, background: '#eaf8ef', color: '#176b37' }}>{message}</div>}
      {error && <div style={{ padding: 11, marginBottom: 12, borderRadius: 8, background: '#fff0ef', color: '#9c3531' }}>{error}</div>}

      {showCreate && <section className="panel" style={{ padding: 20, marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}><h2>Tạo hàng đợi BM</h2><button className="icon-button" onClick={() => setShowCreate(false)}><XCircle size={19}/></button></div>
        <form onSubmit={submitQueue} style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 12 }}>
          <label>Tên hàng đợi<input name="name" required maxLength={100} placeholder="VD: BM US ngày 12/09" /></label>
          <label>Tiền tố tên BM<input name="prefix" required maxLength={80} placeholder="VD: US Store" /></label>
          <label>Số lượng<input name="count" type="number" min={1} max={100} defaultValue={10} required /></label>
          <label>Khoảng nghỉ tối thiểu (giây)<input name="interval" type="number" min={5} max={3600} defaultValue={30} required /></label>
          <label>Token nguồn<select name="tokenId" required value={formTokenId} onChange={(event) => { setFormTokenId(event.target.value); if (pageMode === 'fixed') void loadPages(event.target.value); }}><option value="">Chọn token</option>{tokens.map((token) => <option value={token.id} key={token.id}>{token.label} · {token.status}</option>)}</select></label>
          <label>Page đại diện<select value={pageMode} onChange={(event) => { const mode = event.target.value as 'random' | 'fixed'; setPageMode(mode); if (mode === 'fixed') void loadPages(formTokenId); }}><option value="random">Ngẫu nhiên từ Page của token</option><option value="fixed">Cố định một Page</option></select></label>
          {pageMode === 'fixed' && <label>Page cố định<select name="primaryPage" required><option value="">Chọn Page</option>{pages.map((page) => <option value={page.id} key={page.id}>{page.name} · {page.id}</option>)}</select></label>}
          <label>Timezone ID<input name="timezone" type="number" min={1} max={1000} defaultValue={1} required /></label>
          <label>Vertical<select name="vertical" defaultValue="ADVERTISING"><option value="ADVERTISING">Advertising</option><option value="ECOMMERCE">Ecommerce</option><option value="MARKETING">Marketing</option><option value="RETAIL">Retail</option><option value="TECHNOLOGY">Technology</option><option value="OTHER">Other</option></select></label>
          <label>Email admin (không bắt buộc)<input name="adminEmail" type="email" maxLength={254} placeholder="admin@example.com" /></label>
          <div style={{ gridColumn: '1/-1', display: 'flex', justifyContent: 'flex-end' }}><button className="button primary" disabled={creating || !formTokenId}>{creating ? <LoaderCircle size={16} className="spin"/> : <Factory size={16}/>} {creating ? 'Đang tạo…' : 'Tạo hàng đợi'}</button></div>
        </form>
      </section>}

      <section style={{ display: 'grid', gap: 14 }}>
        {loading && !queues.length ? <div className="panel" style={{ padding: 30, textAlign: 'center' }}>Đang tải hàng đợi…</div> : queues.length === 0 ? <div className="panel" style={{ padding: 34, textAlign: 'center' }}><Factory size={30}/><h3>Chưa có hàng đợi</h3><p className="muted">Tạo một hàng đợi để chuẩn bị tên BM và theo dõi tiến trình.</p></div> : queues.map((queue) => {
          const tone = statusTone(queue.status);
          const pending = queue.items.find((item) => item.status === 'PENDING');
          const wait = Math.max(0, Math.ceil((queue.nextAvailableAt - now) / 1000));
          const progress = queue.count ? Math.round(((queue.completed + queue.failed) / queue.count) * 100) : 0;
          const busy = busyId === queue.id;
          return <article className="panel" key={queue.id} style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
              <div><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><h2 style={{ margin: 0 }}>{queue.name}</h2><span style={{ padding: '5px 9px', borderRadius: 999, fontWeight: 700, fontSize: 12, ...tone }}>{statusLabel(queue.status)}</span></div><p className="muted" style={{ margin: '6px 0 0' }}>Token: {queue.tokenLabel} · {queue.pageMode === 'random' ? 'Page ngẫu nhiên' : `Page ${queue.primaryPage}`} · nghỉ {queue.interval}s</p></div>
              <strong>{queue.completed}/{queue.count} thành công{queue.failed ? ` · ${queue.failed} lỗi` : ''}</strong>
            </div>
            <div style={{ height: 7, borderRadius: 99, background: '#eef0f5', margin: '15px 0 12px', overflow: 'hidden' }}><div style={{ height: '100%', width: `${progress}%`, background: '#7454df' }}/></div>
            {queue.lastError && <div style={{ display: 'flex', gap: 8, padding: 10, borderRadius: 8, marginBottom: 11, background: '#fff0ef', color: '#a13a35' }}><AlertTriangle size={17}/>{queue.lastError}</div>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 13 }}>
              {queue.status === 'READY' && <button className="button primary" disabled={!pending || busy || wait > 0 || now === 0} onClick={() => void createNext(queue)}>{busy ? <LoaderCircle size={16} className="spin"/> : <Play size={16}/>} {wait > 0 ? `Chờ ${wait}s` : pending ? `Tạo mục tiếp theo · ${pending.name}` : 'Không còn mục chờ'}</button>}
              {queue.status === 'READY' && <button className="button" disabled={busy} onClick={() => void queueAction(queue, 'pause')}><Pause size={16}/>Tạm dừng</button>}
              {['PAUSED', 'PAUSED_ERROR'].includes(queue.status) && <button className="button" disabled={busy} onClick={() => void queueAction(queue, 'resume')}><Play size={16}/>Tiếp tục</button>}
              {queue.status === 'PAUSED_ERROR' && queue.items.some((item) => item.status === 'FAILED') && <button className="button" disabled={busy} onClick={() => void queueAction(queue, 'retry_failed')}><RotateCcw size={16}/>Đưa mục lỗi về chờ</button>}
              {!['COMPLETED', 'CANCELLED'].includes(queue.status) && <button className="button" disabled={busy} onClick={() => void queueAction(queue, 'cancel')}><XCircle size={16}/>Hủy hàng đợi</button>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 8 }}>
              {queue.items.slice(0, 12).map((item) => <div key={item.index} style={{ padding: 9, border: '1px solid #eceef3', borderRadius: 8, display: 'flex', gap: 8, alignItems: 'center' }}>{item.status === 'SUCCESS' ? <CheckCircle2 size={16} color="#176b37"/> : item.status === 'FAILED' ? <AlertTriangle size={16} color="#a13a35"/> : <Clock3 size={16} color="#7b8190"/>}<span><strong style={{ display: 'block', fontSize: 12 }}>{item.name}</strong><small className="muted">{item.businessId ? `BM ${item.businessId}` : item.status === 'FAILED' ? 'Lỗi · cần xử lý' : 'Đang chờ'}</small></span></div>)}
              {queue.items.length > 12 && <div className="muted" style={{ padding: 9 }}>+{queue.items.length - 12} mục khác</div>}
            </div>
          </article>;
        })}
      </section>
    </main>, mainTarget,
  ) : null;

  return <>{navPortal}{panelPortal}</>;
}
