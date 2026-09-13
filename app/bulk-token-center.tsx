'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Building2,
  CheckCircle2,
  CreditCard,
  Filter,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Upload,
  UserPlus,
} from 'lucide-react';
import styles from './bulk-token-center.module.css';

type TokenStatus = 'active' | 'invalid' | 'permission_issue' | 'rate_limited' | 'create_restricted' | 'unknown_error';
type Inventory = {
  tokenId: string;
  status: TokenStatus;
  metaUserId?: string;
  metaUserName?: string;
  permissions: string[];
  businessCount: number;
  verifiedBusinessCount: number;
  pageCount: number;
  adAccountCount: number;
  liveAdCount: number;
  dieAdCount: number;
  restrictedAdCount: number;
  totalResources: number;
  warnings: string[];
  lastError?: string;
  scannedAt: string;
};

type TokenRow = {
  id: string;
  label: string;
  fingerprint: string;
  status: TokenStatus;
  metaUserId?: string;
  metaUserName?: string;
  lastError?: string;
  inventory: Inventory | null;
};

type OpsBusiness = { id: string; name: string; verificationStatus: string };
type OpsAdAccount = { id: string; name: string; accountStatus: number; currency?: string; spendCap?: string };
type Billing = {
  id: string;
  name: string;
  accountStatus: number;
  disableReason: number;
  currency: string;
  balance: string;
  amountSpent: string;
  spendCap: string;
  hasFundingSource: boolean;
  fundingType: string;
  fundingDisplay: string;
};

type ImportItem = { label?: string; token: string };

const statusLabel: Record<TokenStatus, string> = {
  active: 'LIVE',
  invalid: 'DIE / hết hạn',
  permission_issue: 'Thiếu quyền',
  rate_limited: 'Rate limit',
  create_restricted: 'Giới hạn tạo BM',
  unknown_error: 'Chưa rõ',
};

const capabilityScopes = [
  ['business_management', 'BM: đọc/tạo/mời người'],
  ['ads_management', 'Ads: quản lý chiến dịch'],
  ['ads_read', 'Ads: đọc trạng thái'],
  ['read_insights', 'Ads/Page: đọc Insights'],
  ['pages_show_list', 'Page: liệt kê Page'],
  ['pages_manage_posts', 'Page: đăng/quản lý bài'],
  ['pages_manage_engagement', 'Page: quản lý tương tác'],
  ['pages_messaging', 'Page: nhắn tin'],
] as const;

function tone(status: TokenStatus) {
  if (status === 'active') return styles.good;
  if (status === 'invalid') return styles.bad;
  if (status === 'unknown_error') return styles.neutral;
  return styles.warn;
}

function parseTokenText(input: string) {
  const items: ImportItem[] = [];
  const seen = new Set<string>();
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith('#')) continue;
    const parts = line.includes('|') ? line.split('|') : line.includes('\t') ? line.split('\t') : line.includes(',') ? line.split(',') : [line];
    const cleaned = parts.map((part) => part.trim()).filter(Boolean);
    const token = cleaned.length > 1 ? cleaned[cleaned.length - 1] : cleaned[0];
    const label = cleaned.length > 1 ? cleaned.slice(0, -1).join(' ').slice(0, 80) : undefined;
    if (!token || token.length < 20 || token.length > 4096 || /\s/.test(token) || seen.has(token)) continue;
    seen.add(token);
    items.push({ label, token });
  }
  return items;
}

function dateText(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN');
}

export default function BulkTokenCenter() {
  const [topTarget, setTopTarget] = useState<Element | null>(null);
  const [mainTarget, setMainTarget] = useState<Element | null>(null);
  const [active, setActive] = useState(false);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileCount, setFileCount] = useState(0);
  const [authorized, setAuthorized] = useState(false);
  const [progress, setProgress] = useState('');

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [bmFilter, setBmFilter] = useState('ALL');
  const [pageFilter, setPageFilter] = useState('ALL');
  const [adsFilter, setAdsFilter] = useState('ALL');
  const [permissionFilter, setPermissionFilter] = useState('ALL');
  const [sort, setSort] = useState('resources_desc');

  const [opsTokenId, setOpsTokenId] = useState('');
  const [businesses, setBusinesses] = useState<OpsBusiness[]>([]);
  const [adAccounts, setAdAccounts] = useState<OpsAdAccount[]>([]);
  const [opsLoading, setOpsLoading] = useState(false);
  const [billing, setBilling] = useState<Billing | null>(null);

  const findTargets = useCallback(() => {
    setMainTarget(document.querySelector('.main-wrap'));
    const headerButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.main-wrap header button'));
    const anchor = headerButtons.find((button) => button.textContent?.trim().toLowerCase() === 'token');
    setTopTarget(anchor?.parentElement || null);
  }, []);

  useEffect(() => {
    const patchSingleUserUi = () => {
      const sidebar = document.querySelector('.sidebar');
      if (!sidebar) return;
      for (const node of Array.from(sidebar.querySelectorAll<HTMLElement>('div'))) {
        if (node.textContent?.trim() === 'PROFILE' && node.childElementCount === 0 && node.parentElement) {
          node.parentElement.style.display = 'none';
          node.parentElement.dataset.singleUserHidden = '1';
        }
      }
      for (const strong of Array.from(sidebar.querySelectorAll<HTMLElement>('strong'))) {
        if (strong.textContent?.trim() === 'Nguyễn Workspace') {
          const box = strong.parentElement?.parentElement as HTMLElement | null;
          if (box) box.style.display = 'none';
        }
      }
    };
    const timer = window.setTimeout(() => { findTargets(); patchSingleUserUi(); }, 0);
    const observer = new MutationObserver(() => { findTargets(); patchSingleUserUi(); });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { window.clearTimeout(timer); observer.disconnect(); };
  }, [findTargets]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/token-inventory', { cache: 'no-store' });
      const data = await response.json() as { tokens?: TokenRow[]; error?: string };
      if (!response.ok) throw new Error(data.error || 'Không tải được kho phân loại token.');
      setTokens(data.tokens || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => void load(), 0);
    const mains = Array.from(document.querySelectorAll('.main-wrap > main')) as HTMLElement[];
    const hidden = mains.filter((main) => !main.classList.contains('bulk-token-main'));
    const previous = hidden.map((main) => main.style.display);
    hidden.forEach((main) => { main.style.display = 'none'; });
    const breadcrumb = document.querySelector('.breadcrumb strong') as HTMLElement | null;
    const oldBreadcrumb = breadcrumb?.textContent || '';
    if (breadcrumb) breadcrumb.textContent = 'Phân loại token';
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
      if (target.closest('.sidebar .nav-item')) setActive(false);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [active]);

  async function onFileChange(next: File | null) {
    setFile(next);
    setFileCount(0);
    setError('');
    if (!next) return;
    if (next.size > 2 * 1024 * 1024) {
      setError('File token tối đa 2 MB.');
      setFile(null);
      return;
    }
    const parsed = parseTokenText(await next.text());
    setFileCount(parsed.length);
    if (!parsed.length) setError('Không tìm thấy token hợp lệ trong file. Dùng mỗi dòng một token hoặc label|token.');
    if (parsed.length > 200) setError(`File có ${parsed.length} token; mỗi lần nhập tối đa 200 token để tránh rate limit.`);
  }

  async function importFile() {
    if (!file || !fileCount) return setError('Chọn file token trước.');
    if (!authorized) return setError('Xác nhận các token thuộc tài khoản/BM bạn quản lý hoặc được ủy quyền.');
    const items = parseTokenText(await file.text());
    if (items.length > 200) return setError('Mỗi lần nhập tối đa 200 token. Hãy chia file thành nhiều phần.');
    setBusy(true);
    setError('');
    setMessage('');
    try {
      let processed = 0;
      let imported = 0;
      let reused = 0;
      for (let index = 0; index < items.length; index += 20) {
        const chunk = items.slice(index, index + 20);
        setProgress(`Đang kiểm tra ${processed + 1}–${processed + chunk.length}/${items.length}…`);
        const response = await fetch('/api/token-inventory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'import', items: chunk }),
        });
        const data = await response.json() as { imported?: number; reused?: number; error?: string };
        if (!response.ok) throw new Error(data.error || 'Nhập token hàng loạt thất bại.');
        imported += data.imported || 0;
        reused += data.reused || 0;
        processed += chunk.length;
      }
      setMessage(`Đã phân loại ${processed} token · mới ${imported} · đã có ${reused}. Raw token không được hiển thị lại.`);
      setFile(null);
      setFileCount(0);
      setAuthorized(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress('');
      setBusy(false);
    }
  }

  async function rescan(ids: string[]) {
    if (!ids.length) return setError('Chọn ít nhất một token để quét lại.');
    setBusy(true);
    setError('');
    setMessage('');
    try {
      let done = 0;
      for (let index = 0; index < ids.length; index += 20) {
        const chunk = ids.slice(index, index + 20);
        setProgress(`Đang quét lại ${done + 1}–${done + chunk.length}/${ids.length}…`);
        const response = await fetch('/api/token-inventory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'scan', ids: chunk }),
        });
        const data = await response.json() as { error?: string };
        if (!response.ok) throw new Error(data.error || 'Quét lại token thất bại.');
        done += chunk.length;
      }
      setMessage(`Đã quét lại ${done} token.`);
      setSelected([]);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress('');
      setBusy(false);
    }
  }

  async function loadOps(tokenId: string) {
    setOpsTokenId(tokenId);
    setBusinesses([]);
    setAdAccounts([]);
    setBilling(null);
    if (!tokenId) return;
    setOpsLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/meta-token-ops?tokenId=${encodeURIComponent(tokenId)}`, { cache: 'no-store' });
      const data = await response.json() as { businesses?: OpsBusiness[]; adAccounts?: OpsAdAccount[]; error?: string };
      if (!response.ok) throw new Error(data.error || 'Không tải được tài nguyên cho tác vụ token.');
      setBusinesses(data.businesses || []);
      setAdAccounts(data.adAccounts || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOpsLoading(false);
    }
  }

  async function invitePerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('confirm') !== 'on') return setError('Xác nhận bạn có quyền mời người vào BM này.');
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/meta-token-ops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'invite_business_user',
          tokenId: opsTokenId,
          businessId: String(form.get('businessId') || ''),
          email: String(form.get('email') || ''),
          role: String(form.get('role') || 'EMPLOYEE'),
          purposeConfirmed: true,
        }),
      });
      const data = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error || 'Không gửi được lời mời.');
      setMessage(data.message || 'Đã gửi lời mời.');
      event.currentTarget.reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function readBilling(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setBilling(null);
    try {
      const response = await fetch('/api/meta-token-ops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'read_billing',
          tokenId: opsTokenId,
          adAccountId: String(form.get('adAccountId') || ''),
        }),
      });
      const data = await response.json() as { billing?: Billing; message?: string; error?: string };
      if (!response.ok) throw new Error(data.error || 'Không đọc được thông tin thanh toán.');
      setBilling(data.billing || null);
      setMessage(data.message || 'Đã đọc trạng thái thanh toán.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openCreateBm() {
    setActive(false);
    window.setTimeout(() => {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar button'));
      buttons.find((button) => button.textContent?.includes('Tạo BM từ token'))?.click();
    }, 0);
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = tokens.filter((token) => {
      const inv = token.inventory;
      if (needle && !`${token.label} ${token.metaUserName || ''} ${token.metaUserId || ''} ${token.fingerprint}`.toLowerCase().includes(needle)) return false;
      if (statusFilter !== 'ALL' && token.status !== statusFilter) return false;
      if (bmFilter === 'HAS' && !(inv && inv.businessCount > 0)) return false;
      if (bmFilter === 'NONE' && (inv?.businessCount || 0) !== 0) return false;
      if (pageFilter === 'HAS' && !(inv && inv.pageCount > 0)) return false;
      if (pageFilter === 'NONE' && (inv?.pageCount || 0) !== 0) return false;
      if (adsFilter === 'LIVE' && !(inv && inv.liveAdCount > 0)) return false;
      if (adsFilter === 'DIE' && !(inv && inv.dieAdCount > 0)) return false;
      if (adsFilter === 'NONE' && (inv?.adAccountCount || 0) !== 0) return false;
      if (permissionFilter !== 'ALL' && !inv?.permissions.includes(permissionFilter)) return false;
      return true;
    });
    return [...rows].sort((a, b) => {
      const ai = a.inventory;
      const bi = b.inventory;
      if (sort === 'bm_desc') return (bi?.businessCount || 0) - (ai?.businessCount || 0);
      if (sort === 'ads_desc') return (bi?.adAccountCount || 0) - (ai?.adAccountCount || 0);
      if (sort === 'pages_desc') return (bi?.pageCount || 0) - (ai?.pageCount || 0);
      if (sort === 'scan_desc') return String(bi?.scannedAt || '').localeCompare(String(ai?.scannedAt || ''));
      return (bi?.totalResources || 0) - (ai?.totalResources || 0);
    });
  }, [tokens, query, statusFilter, bmFilter, pageFilter, adsFilter, permissionFilter, sort]);

  const stats = useMemo(() => ({
    total: tokens.length,
    live: tokens.filter((item) => item.status === 'active').length,
    die: tokens.filter((item) => item.status === 'invalid').length,
    withBm: tokens.filter((item) => (item.inventory?.businessCount || 0) > 0).length,
    withPage: tokens.filter((item) => (item.inventory?.pageCount || 0) > 0).length,
    withLiveAds: tokens.filter((item) => (item.inventory?.liveAdCount || 0) > 0).length,
  }), [tokens]);

  const currentOpsToken = tokens.find((item) => item.id === opsTokenId);
  const currentPermissions = currentOpsToken?.inventory?.permissions || [];

  const topButton = topTarget ? createPortal(
    <button type="button" className={`${styles.topButton} ${active ? styles.topButtonActive : ''}`} onClick={() => setActive(true)}>
      Phân loại token
    </button>,
    topTarget,
  ) : null;

  const panel = active && mainTarget ? createPortal(
    <main className={`bulk-token-main ${styles.main}`}>
      <div className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>TOKEN INVENTORY · META GRAPH API</div>
          <h1>Phân loại & vận hành token</h1>
          <p>Upload file token, kiểm tra LIVE/DIE, đếm BM/Page/TKQC, lọc theo quyền và sắp xếp theo số tài nguyên. Token thô chỉ được gửi tới backend để mã hóa; bảng không hiển thị lại token.</p>
        </div>
        <div className={styles.actions}>
          <button className={styles.miniButton} type="button" disabled={loading} onClick={() => void load()}><RefreshCw size={15} /> Làm mới</button>
          <button className={`${styles.miniButton} ${styles.primary}`} type="button" onClick={openCreateBm}><Building2 size={15} /> Tạo BM</button>
        </div>
      </div>

      {message && <div className={styles.message}><CheckCircle2 size={15} /> {message}</div>}
      {error && <div className={styles.error}>{error}</div>}
      {progress && <div className={styles.message}><LoaderCircle size={15} className="spin" /> {progress}</div>}

      <div className={styles.statRow}>
        {[
          ['Tổng token', stats.total], ['Token LIVE', stats.live], ['Token DIE', stats.die],
          ['Có BM', stats.withBm], ['Có Page', stats.withPage], ['Có LIVE Ads', stats.withLiveAds],
        ].map(([label, value]) => <div className={styles.stat} key={String(label)}><small>{label}</small><strong>{value}</strong></div>)}
      </div>

      <section className={styles.panel}>
        <div className={styles.uploadGrid}>
          <div className={styles.uploadBox}>
            <strong><Upload size={16} /> Nhập file token hàng loạt</strong>
            <p>Hỗ trợ TXT/CSV. Mỗi dòng có thể là <b>token</b> hoặc <b>tên|token</b>. Tối đa 200 token/lần; backend xử lý theo lô 20 để hạn chế rate limit.</p>
            <input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={(event) => void onFileChange(event.target.files?.[0] || null)} />
            <div className={styles.hint}>{file ? `${file.name} · nhận diện ${fileCount} token` : 'Chưa chọn file'}</div>
            <label className={styles.confirm}><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} /><span>Tôi xác nhận các token thuộc tài khoản/BM tôi quản lý hoặc đã được chủ tài khoản ủy quyền.</span></label>
            <button className={`${styles.miniButton} ${styles.primary}`} type="button" disabled={busy || !fileCount || !authorized} onClick={() => void importFile()}>{busy ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />} Kiểm tra & phân loại</button>
          </div>
          <div>
            <strong>Quyền token được dùng thế nào</strong>
            <p className={styles.hint}>App đọc permission thực tế của từng token rồi chỉ bật luồng tương ứng. Scope có tên trong token không tự động vượt role của user/BM/Page.</p>
            <div className={styles.capGrid}>
              {capabilityScopes.map(([scope, label]) => <div className={styles.cap} key={scope}><strong>{scope}</strong><span>{label}</span></div>)}
              <div className={styles.cap}><strong>publish_actions</strong><span>Legacy: không dùng để đăng profile</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.filters}>
          <label><span>Tìm token/user</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên, UID, fingerprint…" /></label>
          <label><span>Token</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">Tất cả</option><option value="active">LIVE</option><option value="invalid">DIE</option><option value="permission_issue">Thiếu quyền</option><option value="rate_limited">Rate limit</option><option value="create_restricted">Giới hạn BM</option></select></label>
          <label><span>BM</span><select value={bmFilter} onChange={(event) => setBmFilter(event.target.value)}><option value="ALL">Tất cả</option><option value="HAS">Có BM</option><option value="NONE">Không có BM</option></select></label>
          <label><span>Page</span><select value={pageFilter} onChange={(event) => setPageFilter(event.target.value)}><option value="ALL">Tất cả</option><option value="HAS">Có Page</option><option value="NONE">Không có Page</option></select></label>
          <label><span>Ads</span><select value={adsFilter} onChange={(event) => setAdsFilter(event.target.value)}><option value="ALL">Tất cả</option><option value="LIVE">Có LIVE Ads</option><option value="DIE">Có DIE Ads</option><option value="NONE">Không có TKQC</option></select></label>
          <label><span>Sắp xếp</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="resources_desc">Nhiều tài nguyên nhất</option><option value="bm_desc">Nhiều BM nhất</option><option value="ads_desc">Nhiều TKQC nhất</option><option value="pages_desc">Nhiều Page nhất</option><option value="scan_desc">Quét mới nhất</option></select></label>
        </div>
        <div className={styles.summary}>
          <span><Filter size={12} /> Hiển thị {filtered.length}/{tokens.length}</span>
          <select value={permissionFilter} onChange={(event) => setPermissionFilter(event.target.value)}><option value="ALL">Tất cả quyền</option>{capabilityScopes.map(([scope]) => <option key={scope} value={scope}>{scope}</option>)}</select>
          <button className={styles.miniButton} type="button" disabled={!selected.length || busy} onClick={() => void rescan(selected)}>Quét lại {selected.length || ''}</button>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th></th><th>Token / User</th><th>Token</th><th>BM</th><th>Page</th><th>TKQC</th><th>LIVE Ads</th><th>DIE Ads</th><th>Tổng</th><th>Quyền chính</th><th>Quét</th><th>Thao tác</th></tr></thead>
            <tbody>
              {loading && !tokens.length ? <tr><td colSpan={12} className={styles.empty}>Đang tải…</td></tr> : filtered.length === 0 ? <tr><td colSpan={12} className={styles.empty}>Không có token phù hợp bộ lọc.</td></tr> : filtered.map((token) => {
                const inv = token.inventory;
                return <tr key={token.id}>
                  <td><input type="checkbox" checked={selected.includes(token.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, token.id])] : current.filter((id) => id !== token.id))} /></td>
                  <td className={styles.name}><strong>{inv?.metaUserName || token.metaUserName || token.label}</strong><small>{token.label} · FP {token.fingerprint}</small><small>{inv?.metaUserId || token.metaUserId || 'UID chưa xác định'}</small></td>
                  <td><span className={`${styles.badge} ${tone(token.status)}`}>{statusLabel[token.status]}</span>{inv?.lastError && <small className={styles.muted}>{inv.lastError}</small>}</td>
                  <td className={styles.count}>{inv?.businessCount ?? '—'}{Boolean(inv?.verifiedBusinessCount) && <small> · {inv?.verifiedBusinessCount} verified</small>}</td>
                  <td className={styles.count}>{inv?.pageCount ?? '—'}</td>
                  <td className={styles.count}>{inv?.adAccountCount ?? '—'}</td>
                  <td className={styles.count}>{inv?.liveAdCount ?? '—'}</td>
                  <td className={styles.count}>{inv?.dieAdCount ?? '—'}</td>
                  <td className={styles.count}>{inv?.totalResources ?? '—'}</td>
                  <td className={styles.scopeCell}>{(inv?.permissions || []).filter((permission) => capabilityScopes.some(([scope]) => scope === permission)).slice(0, 6).map((permission) => <span className={styles.scope} key={permission}>{permission}</span>)}{inv && !inv.permissions.length && <span className={styles.muted}>Không đọc được scope</span>}</td>
                  <td>{dateText(inv?.scannedAt)}</td>
                  <td><div className={styles.inlineButtons}><button className={styles.miniButton} type="button" onClick={() => void rescan([token.id])}>Check</button><button className={styles.miniButton} type="button" onClick={() => void loadOps(token.id)}>Tác vụ</button></div></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.opsGrid}>
          <div className={styles.ops}>
            <h3><KeyRound size={16} /> Tác vụ theo token</h3>
            <label>Token<select value={opsTokenId} onChange={(event) => void loadOps(event.target.value)}><option value="">Chọn token</option>{tokens.map((token) => <option key={token.id} value={token.id}>{token.label} · {statusLabel[token.status]}</option>)}</select></label>
            {opsLoading && <div className={styles.hint}>Đang đọc BM/TKQC của token…</div>}
            {opsTokenId && <div className={styles.capGrid}>{capabilityScopes.map(([scope, label]) => <div className={styles.cap} key={scope}><strong>{currentPermissions.includes(scope) ? '✓' : '—'} {scope}</strong><span>{label}</span></div>)}</div>}
            <button className={`${styles.miniButton} ${styles.primary}`} type="button" disabled={!opsTokenId || !currentPermissions.includes('business_management')} onClick={openCreateBm}><Building2 size={15} /> Mở luồng Tạo BM</button>
            <div className={styles.note}>“Không có BM” trong bộ lọc nghĩa là API không trả về BM nào token đang được phép truy cập; app không khẳng định tài khoản đó chưa từng tạo BM trong quá khứ.</div>
          </div>

          <div className={styles.ops}>
            <h3><UserPlus size={16} /> Chia sẻ BM / thêm người</h3>
            <form className={styles.ops} onSubmit={invitePerson}>
              <label>Business Manager<select name="businessId" required disabled={!businesses.length}><option value="">Chọn BM</option>{businesses.map((business) => <option key={business.id} value={business.id}>{business.name} · {business.id}</option>)}</select></label>
              <label>Email người nhận<input name="email" type="email" required maxLength={254} placeholder="name@company.com" /></label>
              <label>Vai trò<select name="role" defaultValue="EMPLOYEE"><option value="EMPLOYEE">Employee</option><option value="ADMIN">Admin</option></select></label>
              <label className={styles.confirm}><input name="confirm" type="checkbox" /><span>Tôi có quyền mời người này vào BM và hiểu người nhận phải tự chấp nhận lời mời Meta.</span></label>
              <button className={`${styles.miniButton} ${styles.primary}`} disabled={busy || !opsTokenId || !currentPermissions.includes('business_management')}><UserPlus size={15} /> Gửi lời mời</button>
            </form>
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.opsGrid}>
          <div className={styles.ops}>
            <h3><CreditCard size={16} /> Payment & Billing</h3>
            <form className={styles.ops} onSubmit={readBilling}>
              <label>Tài khoản quảng cáo<select name="adAccountId" required disabled={!adAccounts.length}><option value="">Chọn TKQC</option>{adAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.id}</option>)}</select></label>
              <button className={styles.miniButton} disabled={busy || !opsTokenId} type="submit">Đọc trạng thái thanh toán</button>
            </form>
            {billing && <div className={styles.result}>TKQC: {billing.name} ({billing.id}){`\n`}Status: {billing.accountStatus} · Currency: {billing.currency || '—'}{`\n`}Balance: {billing.balance || '—'} · Spent: {billing.amountSpent || '—'} · Spend cap: {billing.spendCap || '—'}{`\n`}Funding source: {billing.hasFundingSource ? (billing.fundingDisplay || billing.fundingType || 'Có') : 'Chưa có'}</div>}
          </div>
          <div>
            <div className={`${styles.note} ${styles.dangerNote}`}><strong>Không nhập thẻ ngân hàng vào app.</strong><br />Marketing API có thể trả về trạng thái/funding source khi quyền cho phép, nhưng app này không thu thập số thẻ, CVV hoặc tự thêm thẻ thanh toán. Việc thêm/đổi thẻ thực hiện trong giao diện Billing chính thức của Meta.</div>
            <div className={styles.note} style={{ marginTop: 10 }}><strong>Partner BM:</strong><br />Mời ADMIN/EMPLOYEE qua <code>business_users</code> được hỗ trợ ở trên. Quan hệ partner-BM tự động không được bật đại trà cho mọi app/token, nên app không giả lập bằng endpoint nội bộ.</div>
          </div>
        </div>
      </section>
    </main>,
    mainTarget,
  ) : null;

  return <>{topButton}{panel}</>;
}
