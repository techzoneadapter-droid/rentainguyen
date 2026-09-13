'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Boxes,
  Building2,
  CheckCircle2,
  ChevronRight,
  DatabaseZap,
  FileUp,
  FolderPlus,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Save,
  Settings2,
  UploadCloud,
} from 'lucide-react';

type TokenStatus = 'active' | 'invalid' | 'permission_issue' | 'rate_limited' | 'create_restricted' | 'unknown_error';
type Token = { id: string; label: string; status: TokenStatus; metaUserName?: string; lastError?: string };
type PageItem = { id: string; name: string };
type WorkspaceAsset = { id: string; name: string; type: string; source: string; metaId?: string };
type TokenResponse = { tokens?: Token[]; error?: string };
type WorkspaceResponse = { assets?: WorkspaceAsset[]; error?: string };
type PagesResponse = { pages?: PageItem[]; error?: string; hint?: string };
type ImportResponse = {
  imported?: number;
  businesses?: number;
  adAccounts?: number;
  pages?: number;
  pixels?: number;
  message?: string;
  error?: string;
};
type CreateResult = {
  id?: string;
  name?: string;
  message?: string;
  error?: string;
  business?: { id: string; name: string; primaryPage?: { id: string; name?: string } };
};
type GuideResponse = {
  error?: string;
  message?: string;
  signedUploadUrl?: string;
  storageBucket?: string;
  storagePath?: string;
  publicUrl?: string;
};

type Mode = 'token' | 'manual';
type ManualType = 'BM' | 'TKQC' | 'Page' | 'Dataset/Pixel';

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const directCreateLabels = [
  'Tạo tài nguyên',
  'Táº¡o tÃ i nguyÃªn',
  'Tạo BM thật',
  'Tạo Business Manager thật',
  'Tạo Business Manager',
  'Thêm hồ sơ',
  'ThÃªm há»“ sÆ¡',
  'Thêm bí kíp',
  'Tạo hàng loạt',
  'Táº¡o hÃ ng loáº¡t',
  'Tạo workflow',
  'Táº¡o workflow',
  'Thiết lập workflow',
  'Thiáº¿t láº­p workflow',
];

function tokenLabel(status: TokenStatus) {
  if (status === 'active') return 'Hoạt động';
  if (status === 'invalid') return 'Hết hạn / không hợp lệ';
  if (status === 'permission_issue') return 'Thiếu quyền';
  if (status === 'rate_limited') return 'Rate limit';
  if (status === 'create_restricted') return 'Giới hạn tạo BM';
  return 'Cần kiểm tra';
}

function chooseRandomPage(pages: PageItem[]) {
  if (!pages.length) return undefined;
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return pages[Math.floor((bytes[0] / 4294967296) * pages.length)] || pages[0];
}

async function uploadToSignedUrl(url: string, file: File) {
  const form = new FormData();
  form.append('cacheControl', '3600');
  form.append('', file);
  const response = await fetch(url, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: form });
  if (!response.ok) throw new Error('Không tải được tệp lên kho lưu trữ.');
}

export default function ResourceCreationHub() {
  const [navTarget, setNavTarget] = useState<Element | null>(null);
  const [mainTarget, setMainTarget] = useState<Element | null>(null);
  const [active, setActive] = useState(false);
  const [mode, setMode] = useState<Mode>('token');
  const [tokens, setTokens] = useState<Token[]>([]);
  const [tokenId, setTokenId] = useState('');
  const [pages, setPages] = useState<PageItem[]>([]);
  const [pageMode, setPageMode] = useState<'random' | 'manual'>('random');
  const [primaryPage, setPrimaryPage] = useState('');
  const [assets, setAssets] = useState<WorkspaceAsset[]>([]);
  const [manualType, setManualType] = useState<ManualType>('BM');
  const [loading, setLoading] = useState(false);
  const [loadingPages, setLoadingPages] = useState(false);
  const [creatingBm, setCreatingBm] = useState(false);
  const [importing, setImporting] = useState(false);
  const [savingManual, setSavingManual] = useState(false);
  const [uploadingGuide, setUploadingGuide] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [bmResult, setBmResult] = useState<CreateResult | null>(null);

  const bms = useMemo(() => assets.filter((asset) => asset.type === 'BM'), [assets]);
  const selectedToken = useMemo(() => tokens.find((token) => token.id === tokenId), [tokens, tokenId]);

  const findTargets = useCallback(() => {
    const navs = document.querySelectorAll('.sidebar nav');
    setNavTarget(navs[0] || null);
    setMainTarget(document.querySelector('.main-wrap'));
  }, []);

  const loadBase = useCallback(async () => {
    setLoading(true);
    try {
      const [tokenResponse, workspaceResponse] = await Promise.all([
        fetch('/api/meta-tokens', { cache: 'no-store' }),
        fetch('/api/workspace', { cache: 'no-store' }),
      ]);
      const tokenData = await tokenResponse.json() as TokenResponse;
      const workspaceData = await workspaceResponse.json() as WorkspaceResponse;
      if (!tokenResponse.ok) throw new Error(tokenData.error || 'Không tải được token.');
      if (!workspaceResponse.ok) throw new Error(workspaceData.error || 'Không tải được workspace.');
      const nextTokens = tokenData.tokens || [];
      setTokens(nextTokens);
      setAssets(workspaceData.assets || []);
      setTokenId((current) => current && nextTokens.some((token) => token.id === current)
        ? current
        : nextTokens.find((token) => token.status === 'active')?.id || nextTokens[0]?.id || '');
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPages = useCallback(async (id: string) => {
    setPages([]);
    setPrimaryPage('');
    if (!id) return;
    setLoadingPages(true);
    try {
      const response = await fetch(`/api/business-manager?tokenId=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const data = await response.json() as PagesResponse;
      if (!response.ok) throw new Error(`${data.error || 'Không tải được Page.'}${data.hint ? ` ${data.hint}` : ''}`);
      setPages(data.pages || []);
      setPageMode((data.pages || []).length ? 'random' : 'manual');
    } catch (err) {
      setPageMode('manual');
      setError((err as Error).message);
    } finally {
      setLoadingPages(false);
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
    const centralize = () => {
      for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('button'))) {
        if (button.closest('[data-resource-create-hub]')) continue;
        const text = button.textContent?.trim() || '';
        if (directCreateLabels.some((label) => text.includes(label))) {
          button.style.display = 'none';
          button.dataset.centralizedCreateHidden = '1';
        }
      }
      document.querySelectorAll<HTMLElement>('[data-production-queue-nav],[data-resource-preset-nav]').forEach((node) => {
        node.style.display = 'none';
        node.dataset.centralizedCreateHidden = '1';
      });
    };
    const timer = window.setTimeout(centralize, 0);
    const observer = new MutationObserver(centralize);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => void loadBase(), 0);
    const mains = Array.from(document.querySelectorAll('.main-wrap > main')) as HTMLElement[];
    const hidden = mains.filter((main) => !main.classList.contains('resource-create-main'));
    const previous = hidden.map((main) => main.style.display);
    hidden.forEach((main) => { main.style.display = 'none'; });
    const breadcrumb = document.querySelector('.breadcrumb strong') as HTMLElement | null;
    const oldBreadcrumb = breadcrumb?.textContent || '';
    if (breadcrumb) breadcrumb.textContent = 'Tạo tài nguyên';
    return () => {
      window.clearTimeout(timer);
      hidden.forEach((main, index) => { main.style.display = previous[index] || ''; });
      if (breadcrumb) breadcrumb.textContent = oldBreadcrumb;
    };
  }, [active, loadBase]);

  useEffect(() => {
    if (!active || mode !== 'token' || !tokenId) return;
    const timer = window.setTimeout(() => void loadPages(tokenId), 0);
    return () => window.clearTimeout(timer);
  }, [active, mode, tokenId, loadPages]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!active) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const navButton = target.closest('.nav-item');
      if (navButton && !navButton.hasAttribute('data-resource-create-nav')) setActive(false);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [active]);

  async function createBusinessManager(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setBmResult(null);
    if (!tokenId) return setError('Chọn token nguồn trước.');
    const form = new FormData(event.currentTarget);
    const confirmed = form.get('confirmed') === 'on';
    if (!confirmed) return setError('Xác nhận tài nguyên được tạo cho doanh nghiệp của bạn hoặc khách hàng đã ủy quyền.');

    let page: PageItem | undefined;
    if (pageMode === 'random') {
      page = chooseRandomPage(pages);
      if (!page) return setError('Token chưa có Page khả dụng để chọn ngẫu nhiên.');
    } else {
      const id = String(form.get('primaryPage') || primaryPage || '');
      if (!/^\d{5,30}$/.test(id)) return setError('Nhập Facebook Page ID hợp lệ.');
      page = pages.find((item) => item.id === id) || { id, name: 'Page nhập thủ công' };
    }

    setCreatingBm(true);
    try {
      const response = await fetch('/api/business-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId,
          name: String(form.get('name') || ''),
          primaryPage: page.id,
          timezone: Number(form.get('timezone') || 140),
          vertical: String(form.get('vertical') || 'ADVERTISING'),
          adminEmail: String(form.get('adminEmail') || ''),
          purposeConfirmed: true,
        }),
      });
      const data = await response.json() as CreateResult;
      if (!response.ok) throw new Error(data.error || 'Không tạo được Business Manager.');
      setBmResult(data);
      setMessage(data.message || `Đã tạo Business Manager ${data.name || data.id || ''}.`);
      await loadBase();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreatingBm(false);
    }
  }

  async function importFromToken() {
    if (!tokenId) return setError('Chọn token nguồn trước.');
    setImporting(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/resource-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import_token', tokenId }),
      });
      const data = await response.json() as ImportResponse;
      if (!response.ok) throw new Error(data.error || 'Không nhập được tài nguyên từ token.');
      setMessage(`${data.message || 'Đã nhập tài nguyên.'} BM ${data.businesses || 0} · TKQC ${data.adAccounts || 0} · Page ${data.pages || 0} · Pixel ${data.pixels || 0}.`);
      await loadBase();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  async function saveManualAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingManual(true);
    setError('');
    setMessage('');
    const form = new FormData(event.currentTarget);
    const metaId = String(form.get('metaId') || '').trim().replace(/^act_/, '');
    if (metaId && !/^\d{5,30}$/.test(metaId)) {
      setSavingManual(false);
      return setError('Meta ID nếu nhập phải gồm 5–30 chữ số.');
    }
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'asset',
          asset: {
            name: String(form.get('name') || ''),
            type: manualType,
            metaId,
            country: String(form.get('country') || 'Chưa rõ'),
            tier: String(form.get('tier') || 'Chưa rõ'),
            limit: String(form.get('limit') || 'Chưa rõ'),
            parent: String(form.get('parent') || ''),
          },
        }),
      });
      const data = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error || 'Không lưu được tài nguyên thủ công.');
      event.currentTarget.reset();
      setManualType('BM');
      setMessage(data.message || 'Đã thêm tài nguyên thủ công.');
      await loadBase();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingManual(false);
    }
  }

  async function uploadGuide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadingGuide(true);
    setError('');
    setMessage('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get('file');
    if (!(file instanceof File) || !file.size) {
      setUploadingGuide(false);
      return setError('Chọn một tệp bí kíp để tải lên.');
    }
    if (file.size > MAX_FILE_SIZE) {
      setUploadingGuide(false);
      return setError('Tệp vượt quá giới hạn 200 MB.');
    }

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
      const prepared = await prepareResponse.json() as GuideResponse;
      if (!prepareResponse.ok || !prepared.signedUploadUrl || !prepared.storageBucket || !prepared.storagePath || !prepared.publicUrl) {
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
      const saved = await saveResponse.json() as GuideResponse;
      if (!saveResponse.ok) throw new Error(saved.error || 'Không lưu được hồ sơ bí kíp.');
      form.reset();
      setMessage(saved.message || 'Đã thêm bí kíp vào workspace.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploadingGuide(false);
    }
  }

  function openHiddenTool(selector: string) {
    setActive(false);
    window.setTimeout(() => document.querySelector<HTMLButtonElement>(selector)?.click(), 0);
  }

  const navPortal = navTarget ? createPortal(
    <button
      type="button"
      data-resource-create-nav
      className={`nav-item ${active ? 'active' : ''}`}
      onClick={() => setActive(true)}
    >
      <FolderPlus size={19} />
      <span>Tạo tài nguyên</span>
    </button>,
    navTarget,
  ) : null;

  const panelPortal = active && mainTarget ? createPortal(
    <main className="resource-create-main" data-resource-create-hub style={{ padding: '32px 36px 50px' }}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">RESOURCE FACTORY</div>
          <h1>Tạo tài nguyên</h1>
          <p>Đây là nơi duy nhất để tạo hoặc thêm tài nguyên mới. Các mục còn lại chỉ dùng để quản lý, kiểm tra trạng thái và đẩy CRM.</p>
        </div>
        <div className="heading-actions">
          <button className="button" type="button" disabled={loading} onClick={() => void loadBase()}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} /> Làm mới nguồn
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, margin: '18px 0' }}>
        <button type="button" className={`panel ${mode === 'token' ? 'selected' : ''}`} onClick={() => setMode('token')} style={{ padding: 18, textAlign: 'left', border: mode === 'token' ? '2px solid #7353e8' : undefined }}>
          <KeyRound size={24} style={{ color: '#7353e8' }} />
          <strong style={{ display: 'block', fontSize: 17, marginTop: 9 }}>Tạo từ token</strong>
          <span className="muted">Tạo Business Manager bằng token đã lưu hoặc nhập các tài nguyên Meta mà token đang truy cập được.</span>
        </button>
        <button type="button" className={`panel ${mode === 'manual' ? 'selected' : ''}`} onClick={() => setMode('manual')} style={{ padding: 18, textAlign: 'left', border: mode === 'manual' ? '2px solid #7353e8' : undefined }}>
          <UploadCloud size={24} style={{ color: '#7353e8' }} />
          <strong style={{ display: 'block', fontSize: 17, marginTop: 9 }}>Thêm thủ công</strong>
          <span className="muted">Thêm BM/TKQC/Page/Pixel bằng thông tin bạn có sẵn hoặc tải tệp Bí kíp lên workspace.</span>
        </button>
      </div>

      {message && <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 12, borderRadius: 9, marginBottom: 14, background: '#eaf8ef', color: '#176b37' }}><CheckCircle2 size={17} />{message}</div>}
      {error && <div style={{ padding: 12, borderRadius: 9, marginBottom: 14, background: '#fff0ef', color: '#9c3531' }}>{error}</div>}

      {mode === 'token' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.35fr) minmax(300px,.65fr)', gap: 16 }}>
          <section className="panel" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: 0 }}>Tạo Business Manager</h2>
                <p className="muted" style={{ margin: '5px 0 0' }}>Mỗi lần gửi đúng 1 yêu cầu tạo BM. App không tự đổi token và không tự retry khi Meta báo lỗi hoặc giới hạn.</p>
              </div>
              <Building2 size={24} style={{ color: '#7353e8' }} />
            </div>

            <label>Token nguồn
              <select value={tokenId} onChange={(event) => { setTokenId(event.target.value); setBmResult(null); }}>
                <option value="">Chọn token</option>
                {tokens.map((token) => <option key={token.id} value={token.id}>{token.label} · {tokenLabel(token.status)}</option>)}
              </select>
            </label>
            {selectedToken?.lastError && <small style={{ display: 'block', color: '#9c3531', marginTop: 5 }}>{selectedToken.lastError}</small>}

            <form onSubmit={createBusinessManager} style={{ display: 'grid', gap: 12, marginTop: 14 }}>
              <label>Tên Business Manager<input name="name" required maxLength={100} placeholder="VD: Nguyen Media" /></label>
              <div className="form-grid">
                <label>Page đại diện
                  <select value={pageMode} onChange={(event) => setPageMode(event.target.value as 'random' | 'manual')}>
                    <option value="random">Ngẫu nhiên từ Page của token</option>
                    <option value="manual">Chọn / nhập Page ID</option>
                  </select>
                </label>
                {pageMode === 'manual' ? (
                  pages.length ? <label>Page<select name="primaryPage" value={primaryPage} onChange={(event) => setPrimaryPage(event.target.value)}><option value="">Chọn Page hoặc nhập ID dưới đây</option>{pages.map((page) => <option key={page.id} value={page.id}>{page.name} · {page.id}</option>)}</select><input name="primaryPageManual" inputMode="numeric" placeholder="Hoặc nhập Page ID" onChange={(event) => { if (event.target.value) setPrimaryPage(event.target.value); }} /></label>
                  : <label>Page ID<input name="primaryPage" value={primaryPage} onChange={(event) => setPrimaryPage(event.target.value)} inputMode="numeric" required placeholder="Facebook Page ID" /></label>
                ) : <div style={{ alignSelf: 'end', padding: 11, borderRadius: 9, background: '#f6f3ff', color: '#5f45b7', fontSize: 12 }}>{loadingPages ? 'Đang đọc Page…' : `${pages.length} Page khả dụng`}</div>}
              </div>
              <div className="form-grid">
                <label>Timezone ID<input name="timezone" type="number" min={1} max={1000} defaultValue={140} required /></label>
                <label>Vertical<select name="vertical" defaultValue="ADVERTISING"><option value="ADVERTISING">Advertising</option><option value="ECOMMERCE">Ecommerce</option><option value="MARKETING">Marketing</option><option value="RETAIL">Retail</option><option value="TECHNOLOGY">Technology</option><option value="OTHER">Other</option></select></label>
              </div>
              <label>Email admin sau khi tạo <small>(không bắt buộc)</small><input name="adminEmail" type="email" maxLength={254} placeholder="admin@example.com" /></label>
              <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}><input name="confirmed" type="checkbox" style={{ width: 17, height: 17, marginTop: 2 }} /><span style={{ fontSize: 13 }}>Tôi xác nhận Business Manager này dùng cho doanh nghiệp của tôi hoặc khách hàng đã ủy quyền.</span></label>
              <button className="button primary" disabled={!tokenId || creatingBm || loadingPages}>
                {creatingBm ? <LoaderCircle size={16} className="spin" /> : <Building2 size={16} />}
                {creatingBm ? 'Đang tạo…' : 'Tạo Business Manager'}
              </button>
            </form>
            {bmResult?.id && <div style={{ marginTop: 14, padding: 13, borderRadius: 10, background: '#eaf8ef', color: '#176b37' }}><strong>Đã tạo {bmResult.business?.name || bmResult.name || 'Business Manager'}</strong><div style={{ marginTop: 4 }}>ID: {bmResult.business?.id || bmResult.id}</div></div>}
          </section>

          <section style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
            <div className="panel" style={{ padding: 20 }}>
              <DatabaseZap size={24} style={{ color: '#7353e8' }} />
              <h2 style={{ margin: '10px 0 6px' }}>Nhập tài nguyên có sẵn</h2>
              <p className="muted">Đọc BM, TKQC, Page và Pixel mà token đang truy cập được rồi đưa vào workspace. Thao tác này không tạo tài nguyên mới trên Meta.</p>
              <button className="button" type="button" disabled={!tokenId || importing} onClick={() => void importFromToken()} style={{ width: '100%', justifyContent: 'center' }}>
                {importing ? <LoaderCircle size={16} className="spin" /> : <DatabaseZap size={16} />}
                {importing ? 'Đang nhập…' : 'Nhập từ token đã chọn'}
              </button>
            </div>

            <div className="panel" style={{ padding: 20 }}>
              <Settings2 size={24} style={{ color: '#7353e8' }} />
              <h2 style={{ margin: '10px 0 6px' }}>Tạo nâng cao</h2>
              <p className="muted">Preset và hàng đợi vẫn được giữ, nhưng không còn là mục tạo độc lập trên sidebar.</p>
              <div style={{ display: 'grid', gap: 8 }}>
                <button className="button" type="button" onClick={() => openHiddenTool('[data-resource-preset-nav]')}>Preset tài nguyên <ChevronRight size={16} /></button>
                <button className="button" type="button" onClick={() => openHiddenTool('[data-production-queue-nav]')}>Hàng đợi sản xuất <ChevronRight size={16} /></button>
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16 }}>
          <section className="panel" style={{ padding: 20 }}>
            <FolderPlus size={24} style={{ color: '#7353e8' }} />
            <h2 style={{ margin: '10px 0 6px' }}>Thêm tài nguyên Meta thủ công</h2>
            <p className="muted">Chỉ lưu hồ sơ vào workspace. Nếu có Meta ID, bạn có thể chọn token khi Health Check để kiểm tra sau.</p>
            <form onSubmit={saveManualAsset} style={{ display: 'grid', gap: 12, marginTop: 14 }}>
              <label>Loại tài nguyên<select value={manualType} onChange={(event) => setManualType(event.target.value as ManualType)}><option value="BM">Business Manager</option><option value="TKQC">Tài khoản quảng cáo</option><option value="Page">Page</option><option value="Dataset/Pixel">Dataset / Pixel</option></select></label>
              <label>Tên<input name="name" required maxLength={150} placeholder="Tên để quản lý trong workspace" /></label>
              <label>Meta ID <small>(không bắt buộc)</small><input name="metaId" inputMode="numeric" placeholder="ID BM / TKQC / Page / Pixel" /></label>
              <div className="form-grid">
                <label>Quốc gia<select name="country" defaultValue="Chưa rõ"><option>Chưa rõ</option><option>VN</option><option>US</option></select></label>
                <label>Phân loại<select name="tier" defaultValue="Chưa rõ"><option>Chưa rõ</option><option>BM0</option><option>BM3</option><option>BM5</option><option>BM10</option><option>BM25</option><option>BM50</option></select></label>
              </div>
              <label>Hạn mức / ghi chú<input name="limit" defaultValue="Chưa rõ" /></label>
              {manualType !== 'BM' && <label>BM liên kết<select name="parent"><option value="">Chưa liên kết</option>{bms.map((bm) => <option key={bm.id} value={bm.id}>{bm.name}</option>)}</select></label>}
              <button className="button primary" disabled={savingManual}>{savingManual ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}{savingManual ? 'Đang lưu…' : 'Thêm vào workspace'}</button>
            </form>
          </section>

          <section className="panel" style={{ padding: 20 }}>
            <FileUp size={24} style={{ color: '#7353e8' }} />
            <h2 style={{ margin: '10px 0 6px' }}>Tải Bí kíp thủ công</h2>
            <p className="muted">Tải file text, JSON/config, ZIP hoặc file cài đặt lên kho. Tệp tối đa 200 MB và không tự chạy.</p>
            <form onSubmit={uploadGuide} style={{ display: 'grid', gap: 12, marginTop: 14 }}>
              <label>Tên Bí kíp<input name="title" maxLength={160} placeholder="Để trống sẽ dùng tên file" /></label>
              <label>Chủ đề<input name="category" maxLength={100} defaultValue="Khác" /></label>
              <label>Mô tả<textarea name="summary" rows={3} maxLength={2000} /></label>
              <label>Giá tham khảo<input name="price" type="number" min={0} step={1000} defaultValue={0} /></label>
              <label>File<input name="file" type="file" required /></label>
              <button className="button primary" disabled={uploadingGuide}>{uploadingGuide ? <LoaderCircle size={16} className="spin" /> : <FileUp size={16} />}{uploadingGuide ? 'Đang tải…' : 'Tải lên workspace'}</button>
            </form>
          </section>
        </div>
      )}

      <section className="panel" style={{ padding: 18, marginTop: 16, display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
        <div><strong>Sau khi tạo xong</strong><p className="muted" style={{ margin: '4px 0 0' }}>Kiểm tra LIVE/DIE, vòng đời và trạng thái CRM trong Trung tâm tài nguyên.</p></div>
        <button className="button" type="button" onClick={() => openHiddenTool('[data-resource-center-nav]')}><Boxes size={16} /> Mở Trung tâm tài nguyên</button>
      </section>
    </main>,
    mainTarget,
  ) : null;

  return <>{navPortal}{panelPortal}</>;
}
