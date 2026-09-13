'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Building2,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';

type TokenStatus =
  | 'active'
  | 'invalid'
  | 'permission_issue'
  | 'rate_limited'
  | 'create_restricted'
  | 'unknown_error';

type TokenItem = {
  id: string;
  label: string;
  status: TokenStatus;
  metaUserName?: string;
  lastError?: string;
};

type PageItem = {
  id: string;
  name: string;
  tasks?: string[];
};

type TokensResponse = { tokens?: TokenItem[]; error?: string };
type PreflightResponse = {
  user?: { id: string; name: string };
  pages?: PageItem[];
  permissions?: { businessManagement: boolean; pagesShowList: boolean };
  tokenStatus?: TokenStatus;
  error?: string;
  hint?: string;
};

type CreateResponse = {
  id?: string;
  name?: string;
  saved?: boolean;
  tokenStatus?: TokenStatus;
  message?: string;
  error?: string;
  business?: {
    id: string;
    name: string;
    verificationStatus: string;
    verified: boolean;
    creationTime: string;
    timezoneId: string;
    primaryPage: { id: string; name?: string };
    createdBy: { id: string; name?: string };
  };
};

const verticals = [
  ['ADVERTISING', 'Advertising'],
  ['AUTOMOTIVE', 'Automotive'],
  ['CONSUMER_PACKAGED_GOODS', 'Consumer Packaged Goods'],
  ['ECOMMERCE', 'Ecommerce'],
  ['EDUCATION', 'Education'],
  ['ENERGY_AND_UTILITIES', 'Energy & Utilities'],
  ['ENTERTAINMENT_AND_MEDIA', 'Entertainment & Media'],
  ['FINANCIAL_SERVICES', 'Financial Services'],
  ['GAMING', 'Gaming'],
  ['GOVERNMENT_AND_POLITICS', 'Government & Politics'],
  ['MARKETING', 'Marketing'],
  ['ORGANIZATIONS_AND_ASSOCIATIONS', 'Organizations & Associations'],
  ['PROFESSIONAL_SERVICES', 'Professional Services'],
  ['RETAIL', 'Retail'],
  ['TECHNOLOGY', 'Technology'],
  ['TELECOM', 'Telecom'],
  ['TRAVEL', 'Travel'],
  ['OTHER', 'Other'],
] as const;

const legacyCreateLabels = new Set([
  'Tạo tài nguyên',
  'Táº¡o tÃ i nguyÃªn',
  'Tạo BM thật',
  'Tạo Business Manager thật',
  'Tạo hàng loạt',
  'Táº¡o hÃ ng loáº¡t',
  'Tạo workflow',
  'Táº¡o workflow',
  'Thiết lập workflow',
  'Thiáº¿t láº­p workflow',
]);

function tokenLabel(status: TokenStatus) {
  if (status === 'active') return 'Hoạt động';
  if (status === 'invalid') return 'Hết hạn / không hợp lệ';
  if (status === 'permission_issue') return 'Thiếu quyền';
  if (status === 'rate_limited') return 'Rate limit';
  if (status === 'create_restricted') return 'Meta giới hạn tạo BM';
  return 'Cần kiểm tra';
}

function verificationLabel(status?: string) {
  if (!status || status === 'unknown') return 'Chưa rõ';
  if (status.toLowerCase() === 'verified') return 'Đã xác minh';
  if (status.toLowerCase() === 'not_verified') return 'Chưa xác minh';
  return status;
}

function formatTime(value?: string) {
  if (!value) return 'Chưa rõ';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
}

export default function BmTokenCreatorHub() {
  const [navTarget, setNavTarget] = useState<Element | null>(null);
  const [mainTarget, setMainTarget] = useState<Element | null>(null);
  const [active, setActive] = useState(false);
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [tokenId, setTokenId] = useState('');
  const [pages, setPages] = useState<PageItem[]>([]);
  const [primaryPage, setPrimaryPage] = useState('');
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [loadingPages, setLoadingPages] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [result, setResult] = useState<CreateResponse | null>(null);

  const selectedToken = useMemo(
    () => tokens.find((token) => token.id === tokenId),
    [tokens, tokenId],
  );

  const findTargets = useCallback(() => {
    const navs = document.querySelectorAll('.sidebar nav');
    setNavTarget(navs[0] || null);
    setMainTarget(document.querySelector('.main-wrap'));
  }, []);

  const loadTokens = useCallback(async () => {
    setLoadingTokens(true);
    setError('');
    try {
      const response = await fetch('/api/meta-tokens', { cache: 'no-store' });
      const data = await response.json() as TokensResponse;
      if (!response.ok) throw new Error(data.error || 'Không tải được danh sách token.');
      const next = data.tokens || [];
      setTokens(next);
      setTokenId((current) => (
        current && next.some((token) => token.id === current)
          ? current
          : next.find((token) => token.status === 'active')?.id || next[0]?.id || ''
      ));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingTokens(false);
    }
  }, []);

  const loadPreflight = useCallback(async (id: string) => {
    setPages([]);
    setPrimaryPage('');
    setHint('');
    setResult(null);
    if (!id) return;

    setLoadingPages(true);
    setError('');
    try {
      const response = await fetch(`/api/bm-create?tokenId=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const data = await response.json() as PreflightResponse;
      if (!response.ok) throw new Error(`${data.error || 'Token không vượt qua bước kiểm tra.'}${data.hint ? ` ${data.hint}` : ''}`);
      const nextPages = data.pages || [];
      setPages(nextPages);
      setPrimaryPage(nextPages.length === 1 ? nextPages[0].id : '');
      setHint(data.hint || '');
    } catch (err) {
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
    const hideLegacyCreateEntrypoints = () => {
      for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('button'))) {
        if (button.closest('[data-bm-token-hub]') || button.hasAttribute('data-bm-token-nav')) continue;
        const text = button.textContent?.trim() || '';
        if (legacyCreateLabels.has(text)) {
          button.style.display = 'none';
          button.dataset.bmTokenOnlyHidden = '1';
        }
      }
      document.querySelectorAll<HTMLElement>('[data-production-queue-nav],[data-resource-preset-nav]').forEach((node) => {
        node.style.display = 'none';
        node.dataset.bmTokenOnlyHidden = '1';
      });
    };

    const timer = window.setTimeout(hideLegacyCreateEntrypoints, 0);
    const observer = new MutationObserver(hideLegacyCreateEntrypoints);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => void loadTokens(), 0);
    const mains = Array.from(document.querySelectorAll('.main-wrap > main')) as HTMLElement[];
    const hidden = mains.filter((main) => !main.classList.contains('bm-token-create-main'));
    const previous = hidden.map((main) => main.style.display);
    hidden.forEach((main) => { main.style.display = 'none'; });

    const breadcrumb = document.querySelector('.breadcrumb strong') as HTMLElement | null;
    const oldBreadcrumb = breadcrumb?.textContent || '';
    if (breadcrumb) breadcrumb.textContent = 'Tạo BM từ token';

    return () => {
      window.clearTimeout(timer);
      hidden.forEach((main, index) => { main.style.display = previous[index] || ''; });
      if (breadcrumb) breadcrumb.textContent = oldBreadcrumb;
    };
  }, [active, loadTokens]);

  useEffect(() => {
    if (!active || !tokenId) return;
    const timer = window.setTimeout(() => void loadPreflight(tokenId), 0);
    return () => window.clearTimeout(timer);
  }, [active, tokenId, loadPreflight]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!active) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const navButton = target.closest('.nav-item');
      if (navButton && !navButton.hasAttribute('data-bm-token-nav')) setActive(false);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [active]);

  function openTokenManager() {
    setActive(false);
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('[data-token-manager-nav]')?.click();
    }, 0);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setResult(null);

    if (!tokenId) return setError('Chọn token nguồn trước.');
    if (!primaryPage) return setError('Chọn Page đại diện mà token đang quản lý.');
    if (!confirmed) return setError('Xác nhận BM được tạo cho doanh nghiệp của bạn hoặc khách hàng đã ủy quyền.');

    const form = new FormData(event.currentTarget);
    setCreating(true);
    try {
      const response = await fetch('/api/bm-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId,
          name: String(form.get('name') || ''),
          primaryPage,
          timezone: Number(form.get('timezone') || 140),
          vertical: String(form.get('vertical') || 'ADVERTISING'),
          purposeConfirmed: true,
        }),
      });
      const data = await response.json() as CreateResponse;
      if (!response.ok) throw new Error(data.error || 'Không tạo được Business Manager.');
      setResult(data);
      setMessage(data.message || 'Business Manager đã được tạo.');
      await loadTokens();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  const navPortal = navTarget ? createPortal(
    <button
      type="button"
      data-bm-token-nav
      className={`nav-item ${active ? 'active' : ''}`}
      onClick={() => setActive(true)}
    >
      <Building2 size={19} />
      <span>Tạo BM từ token</span>
    </button>,
    navTarget,
  ) : null;

  const panelPortal = active && mainTarget ? createPortal(
    <main className="bm-token-create-main" data-bm-token-hub style={{ padding: '32px 36px 50px' }}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">META BUSINESS MANAGER</div>
          <h1>Tạo BM từ token</h1>
          <p>Luồng này chỉ tạo một Business Manager bằng token bạn đã tự thêm vào kho token. Không mời admin, không tạo TKQC/Page/Pixel, không tự đổi token và không tự retry.</p>
        </div>
        <div className="heading-actions">
          <button className="button" type="button" disabled={loadingTokens} onClick={() => void loadTokens()}>
            <RefreshCw size={16} className={loadingTokens ? 'spin' : ''} /> Làm mới token
          </button>
          <button className="button" type="button" onClick={openTokenManager}>
            <KeyRound size={16} /> Quản lý token
          </button>
        </div>
      </div>

      {message && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 12, borderRadius: 9, margin: '16px 0', background: '#eaf8ef', color: '#176b37' }}>
          <CheckCircle2 size={17} /> {message}
        </div>
      )}
      {error && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: 9, margin: '16px 0', background: '#fff0ef', color: '#9c3531' }}>
          <ShieldAlert size={17} style={{ marginTop: 1, flex: '0 0 auto' }} /> <span>{error}</span>
        </div>
      )}
      {hint && !error && (
        <div style={{ padding: 12, borderRadius: 9, margin: '16px 0', background: '#fff8e8', color: '#7c5a13' }}>{hint}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(300px,.7fr)', gap: 16, marginTop: 18 }}>
        <section className="panel" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <h2 style={{ margin: 0 }}>Thông tin Business Manager</h2>
              <p className="muted" style={{ margin: '5px 0 0' }}>Trước khi tạo, app kiểm tra token, quyền business_management + pages_show_list và xác nhận Page thuộc danh sách Page token đang quản lý.</p>
            </div>
            <Building2 size={24} style={{ color: '#7353e8' }} />
          </div>

          <label>Token nguồn
            <select
              value={tokenId}
              onChange={(event) => {
                setTokenId(event.target.value);
                setResult(null);
                setConfirmed(false);
              }}
            >
              <option value="">Chọn token</option>
              {tokens.map((token) => (
                <option key={token.id} value={token.id}>{token.label} · {tokenLabel(token.status)}</option>
              ))}
            </select>
          </label>
          {selectedToken?.metaUserName && <small className="muted">Meta user: {selectedToken.metaUserName}</small>}
          {selectedToken?.lastError && <small style={{ display: 'block', color: '#9c3531', marginTop: 5 }}>{selectedToken.lastError}</small>}

          {!tokens.length && !loadingTokens && (
            <div style={{ marginTop: 12, padding: 12, borderRadius: 9, background: '#f6f3ff' }}>
              Chưa có token nào trong kho. <button type="button" className="button" onClick={openTokenManager} style={{ marginLeft: 8 }}>Thêm token</button>
            </div>
          )}

          <form onSubmit={submit} style={{ display: 'grid', gap: 12, marginTop: 16 }}>
            <label>Tên Business Manager
              <input name="name" required minLength={2} maxLength={100} placeholder="VD: Techzone Media" />
            </label>

            <label>Page đại diện
              <select
                value={primaryPage}
                onChange={(event) => setPrimaryPage(event.target.value)}
                required
                disabled={!tokenId || loadingPages || pages.length === 0}
              >
                <option value="">{loadingPages ? 'Đang kiểm tra token và tải Page…' : 'Chọn Page'}</option>
                {pages.map((page) => (
                  <option key={page.id} value={page.id}>{page.name} · {page.id}</option>
                ))}
              </select>
            </label>
            {!loadingPages && tokenId && <small className="muted">{pages.length} Page khả dụng từ token đã chọn.</small>}

            <div className="form-grid">
              <label>Timezone ID
                <input name="timezone" type="number" min={1} max={1000} defaultValue={140} required />
              </label>
              <label>Vertical
                <select name="vertical" defaultValue="ADVERTISING">
                  {verticals.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>

            <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                style={{ width: 17, height: 17, marginTop: 2 }}
              />
              <span style={{ fontSize: 13 }}>Tôi xác nhận BM này dùng cho doanh nghiệp của tôi hoặc khách hàng đã ủy quyền.</span>
            </label>

            <button
              className="button primary"
              disabled={!tokenId || !primaryPage || !confirmed || loadingPages || creating}
            >
              {creating ? <LoaderCircle size={16} className="spin" /> : <Building2 size={16} />}
              {creating ? 'Đang gửi một yêu cầu tạo BM…' : 'Tạo Business Manager'}
            </button>
          </form>
        </section>

        <section style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <div className="panel" style={{ padding: 20 }}>
            <KeyRound size={24} style={{ color: '#7353e8' }} />
            <h2 style={{ margin: '10px 0 6px' }}>Token được xử lý thế nào?</h2>
            <p className="muted" style={{ lineHeight: 1.65 }}>Giá trị token không được hiển thị lại ở màn hình này. API chỉ lấy token đã mã hóa ở phía server để gọi Meta, và phản hồi cho giao diện chỉ chứa trạng thái, nhãn token và dữ liệu BM.</p>
          </div>

          <div className="panel" style={{ padding: 20 }}>
            <ShieldAlert size={24} style={{ color: '#7353e8' }} />
            <h2 style={{ margin: '10px 0 6px' }}>Giới hạn an toàn</h2>
            <p className="muted" style={{ lineHeight: 1.65, marginBottom: 0 }}>Mỗi lần bấm chỉ gửi đúng một POST tạo BM. Nếu Meta trả lỗi, app dừng ngay để bạn kiểm tra; không tự chuyển token, không lặp lại yêu cầu và không thực hiện thao tác tài nguyên khác.</p>
          </div>

          {result?.id && (
            <div className="panel" style={{ padding: 20, border: '1px solid #bfe3ca', background: '#f4fbf6' }}>
              <CheckCircle2 size={26} style={{ color: '#26864b' }} />
              <h2 style={{ margin: '10px 0 8px' }}>Đã tạo BM</h2>
              <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                <div><span className="muted">Tên: </span><strong>{result.business?.name || result.name}</strong></div>
                <div><span className="muted">Business ID: </span><strong>{result.business?.id || result.id}</strong></div>
                <div><span className="muted">Xác minh: </span><strong>{verificationLabel(result.business?.verificationStatus)}</strong></div>
                <div><span className="muted">Page: </span><strong>{result.business?.primaryPage?.name || ''} · {result.business?.primaryPage?.id || primaryPage}</strong></div>
                <div><span className="muted">Tạo lúc: </span><strong>{formatTime(result.business?.creationTime)}</strong></div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>,
    mainTarget,
  ) : null;

  return <>{navPortal}{panelPortal}</>;
}
