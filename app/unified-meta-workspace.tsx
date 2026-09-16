'use client';

import { useMemo, useRef, useState } from 'react';
import {
  BadgeCheck,
  Building2,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  FileUp,
  Flag,
  Home,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import type { Asset } from '../lib/data';
import styles from './unified-meta-workspace.module.css';

type Mode = 'home' | 'manage' | 'create';
type ResourceTab = 'BM' | 'TKQC' | 'Page';
type CreateTab = 'token' | 'bm' | 'legacy';
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
  warnings?: string[];
  lastError?: string;
  scannedAt?: string;
};

type TokenRow = {
  id: string;
  label: string;
  status: TokenStatus;
  metaUserId?: string;
  metaUserName?: string;
  lastError?: string;
  inventory: Inventory | null;
};

type ImportItem = { label?: string; token: string };
type PageItem = { id: string; name: string; tasks?: string[] };

type BmPreflight = {
  user?: { id: string; name: string };
  pages?: PageItem[];
  permissions?: { businessManagement: boolean; pagesShowList: boolean };
  hint?: string;
  error?: string;
};

const STATUS_TEXT: Record<TokenStatus, string> = {
  active: 'LIVE',
  invalid: 'DIE',
  permission_issue: 'Thiếu quyền',
  rate_limited: 'Rate limit',
  create_restricted: 'Giới hạn tạo',
  unknown_error: 'Chưa kiểm tra',
};

const RESOURCE_META: Record<ResourceTab, { label: string; icon: typeof Building2 }> = {
  BM: { label: 'BM', icon: Building2 },
  TKQC: { label: 'ADS', icon: CreditCard },
  Page: { label: 'PAGE', icon: Flag },
};

function metaId(asset: Asset) {
  return asset.metaId || asset.id.match(/meta:(\d{5,30})$/)?.[1] || asset.id;
}

function parseTokens(input: string) {
  const out: ImportItem[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown, label?: unknown) => {
    const token = String(raw ?? '').trim().replace(/^['"]|['"]$/g, '');
    if (token.length < 20 || token.length > 4096 || /\s/.test(token) || seen.has(token)) return;
    seen.add(token);
    const cleanLabel = String(label ?? '').trim().slice(0, 80);
    out.push({ token, label: cleanLabel || undefined });
  };

  try {
    const walk = (value: unknown, label = '') => {
      if (Array.isArray(value)) {
        value.forEach((item) => walk(item, label));
        return;
      }
      if (!value || typeof value !== 'object') return;
      const row = value as Record<string, unknown>;
      const next = String(row.label ?? row.name ?? row.email ?? label);
      Object.entries(row).forEach(([key, value]) => {
        if (/^(access_?token|token)$/i.test(key)) push(value, next);
        else if (value && typeof value === 'object') walk(value, next);
      });
    };
    walk(JSON.parse(input));
  } catch {
    // Text formats are handled below.
  }

  input.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    const url = line.match(/[?&]access_token=([^&#\s]+)/i);
    if (url) push(decodeURIComponent(url[1]));
    const named = line.match(/(?:access_?token|token)\s*[:=]\s*['"]?([^'"\s,;]+)/i);
    if (named) push(named[1]);
    const parts = line.split(/[|\t,;]/).map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1) push(parts.at(-1), parts.slice(0, -1).join(' '));
    else push(line);
  });

  return out;
}

function decodeFile(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  return new TextDecoder('utf-8').decode(buffer);
}

export default function UnifiedMetaWorkspace() {
  const [mode, setMode] = useState<Mode>('home');
  const [resourceTab, setResourceTab] = useState<ResourceTab>('BM');
  const [createTab, setCreateTab] = useState<CreateTab>('token');
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedToken, setSelectedToken] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [tokenText, setTokenText] = useState('');
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [bmName, setBmName] = useState('');
  const [bmPages, setBmPages] = useState<PageItem[]>([]);
  const [bmPage, setBmPage] = useState('');
  const [bmTimezone, setBmTimezone] = useState('140');
  const [bmVertical, setBmVertical] = useState('ADVERTISING');
  const [bmReady, setBmReady] = useState(false);

  const liveTokens = useMemo(() => tokens.filter((token) => token.status === 'active'), [tokens]);
  const currentToken = useMemo(() => tokens.find((token) => token.id === selectedToken), [tokens, selectedToken]);
  const currentPermissions = currentToken?.inventory?.permissions || [];

  const filteredAssets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return assets.filter((asset) => {
      if (asset.type !== resourceTab) return false;
      if (selectedToken && asset.sourceTokenId && asset.sourceTokenId !== selectedToken) return false;
      if (!needle) return true;
      return `${asset.name} ${metaId(asset)} ${asset.status} ${asset.verificationStatus || ''}`.toLowerCase().includes(needle);
    });
  }, [assets, query, resourceTab, selectedToken]);

  const stats = useMemo(() => ({
    bm: assets.filter((asset) => asset.type === 'BM').length,
    ads: assets.filter((asset) => asset.type === 'TKQC').length,
    pages: assets.filter((asset) => asset.type === 'Page').length,
  }), [assets]);

  async function loadTokens() {
    const response = await fetch('/api/token-inventory', { cache: 'no-store' });
    const data = await response.json() as { tokens?: TokenRow[]; error?: string };
    if (!response.ok) throw new Error(data.error || 'Không tải được kho token.');
    const next = data.tokens || [];
    setTokens(next);
    setSelectedToken((current) => current && next.some((token) => token.id === current)
      ? current
      : next.find((token) => token.status === 'active')?.id || next[0]?.id || '');
    return next;
  }

  async function loadAssets() {
    const response = await fetch('/api/workspace', { cache: 'no-store' });
    const data = await response.json() as { assets?: Asset[]; error?: string };
    if (!response.ok) throw new Error(data.error || 'Không tải được tài nguyên.');
    setAssets(data.assets || []);
    return data.assets || [];
  }

  async function refreshAll() {
    setLoading(true);
    setError('');
    try {
      await Promise.all([loadTokens(), loadAssets()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function openMode(next: Mode) {
    setMode(next);
    setMessage('');
    setError('');
    setSelectedIds([]);
    if (next !== 'home' && tokens.length === 0 && assets.length === 0) await refreshAll();
  }

  async function onTokenFile(file: File | null) {
    setFileName(file?.name || '');
    setError('');
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('File token tối đa 5 MB.');
      return;
    }
    setTokenText(decodeFile(await file.arrayBuffer()));
  }

  async function importCheckAndSync() {
    const items = parseTokens(tokenText);
    if (!items.length) {
      setError('Chưa tìm thấy token hợp lệ trong nội dung đã nhập.');
      return;
    }
    if (items.length > 200) {
      setError('Mỗi lượt tối đa 200 token để tránh tự gây rate limit.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    const activeIds = new Set<string>();
    let imported = 0;
    let reused = 0;
    let synced = 0;
    let resources = 0;
    const syncErrors: string[] = [];

    try {
      for (let index = 0; index < items.length; index += 20) {
        const chunk = items.slice(index, index + 20);
        setProgress(`Đang check token ${index + 1}–${index + chunk.length}/${items.length}…`);
        const response = await fetch('/api/token-inventory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'import', items: chunk }),
        });
        const data = await response.json() as {
          imported?: number;
          reused?: number;
          inventories?: Inventory[];
          error?: string;
        };
        if (!response.ok) throw new Error(data.error || 'Không nhập được token.');
        imported += data.imported || 0;
        reused += data.reused || 0;
        (data.inventories || []).filter((item) => item.status === 'active').forEach((item) => activeIds.add(item.tokenId));
      }

      const ids = Array.from(activeIds);
      for (let index = 0; index < ids.length; index += 1) {
        setProgress(`Token LIVE ${index + 1}/${ids.length}: đang đọc toàn bộ BM, ADS và Page…`);
        try {
          const response = await fetch('/api/resource-create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'import_token', tokenId: ids[index] }),
          });
          const data = await response.json() as { imported?: number; error?: string };
          if (!response.ok) throw new Error(data.error || 'Không đồng bộ được tài nguyên.');
          synced += 1;
          resources += data.imported || 0;
        } catch (err) {
          syncErrors.push((err as Error).message);
        }
      }

      await Promise.all([loadTokens(), loadAssets()]);
      setTokenText('');
      setFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setMessage(`Đã xử lý ${items.length} token · mới ${imported} · đã có ${reused} · LIVE ${activeIds.size} · đồng bộ ${synced} token / ${resources} tài nguyên.${syncErrors.length ? ` ${syncErrors.length} token đồng bộ chưa đủ, xem lỗi ở danh sách token.` : ''}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  async function checkOneToken(tokenId: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setProgress('Đang check token và quyền…');
      const scan = await fetch('/api/token-inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scan', ids: [tokenId] }),
      });
      const scanData = await scan.json() as { inventories?: Inventory[]; error?: string };
      if (!scan.ok) throw new Error(scanData.error || 'Check token thất bại.');
      const inventory = scanData.inventories?.[0];
      if (inventory?.status === 'active') {
        setProgress('Token LIVE, đang đồng bộ toàn bộ tài nguyên…');
        const sync = await fetch('/api/resource-create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'import_token', tokenId }),
        });
        const syncData = await sync.json() as { imported?: number; message?: string; error?: string };
        if (!sync.ok) throw new Error(syncData.error || 'Token LIVE nhưng đồng bộ tài nguyên thất bại.');
        setMessage(syncData.message || `Đã đồng bộ ${syncData.imported || 0} tài nguyên.`);
      } else {
        setMessage(`Token đã check: ${inventory ? STATUS_TEXT[inventory.status] : 'không xác định'}.`);
      }
      await Promise.all([loadTokens(), loadAssets()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  async function syncCurrentToken() {
    if (!selectedToken) {
      setError('Chọn token trước.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      setProgress('Đang đồng bộ BM, ADS và Page của token đã chọn…');
      const response = await fetch('/api/resource-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import_token', tokenId: selectedToken }),
      });
      const data = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error || 'Không đồng bộ được tài nguyên.');
      await loadAssets();
      setMessage(data.message || 'Đã đồng bộ tài nguyên.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  async function healthSelected() {
    const ids = selectedIds.length ? selectedIds : filteredAssets.slice(0, 100).map((asset) => asset.id);
    if (!ids.length) {
      setError('Không có tài nguyên để check.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      setProgress(`Đang check ${ids.length} tài nguyên…`);
      const response = await fetch('/api/resource-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, tokenId: selectedToken || undefined }),
      });
      const data = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error || 'Check tài nguyên thất bại.');
      setMessage(data.message || 'Đã check tài nguyên.');
      await loadAssets();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  async function loadBmPages() {
    if (!selectedToken) {
      setError('Chọn token LIVE trước.');
      return;
    }
    setBusy(true);
    setError('');
    setBmReady(false);
    try {
      const response = await fetch(`/api/bm-create?tokenId=${encodeURIComponent(selectedToken)}`, { cache: 'no-store' });
      const data = await response.json() as BmPreflight;
      if (!response.ok) throw new Error(data.error || 'Token chưa đủ điều kiện tạo BM.');
      const pages = data.pages || [];
      setBmPages(pages);
      setBmPage(pages.length === 1 ? pages[0].id : '');
      setBmReady(Boolean(data.permissions?.businessManagement && data.permissions?.pagesShowList && pages.length));
      setMessage(pages.length ? `Đã đọc ${pages.length} Page có thể dùng làm Page đại diện.` : data.hint || 'Token chưa có Page phù hợp.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createBm() {
    if (!selectedToken || !bmName.trim() || !bmPage) {
      setError('Chọn token, nhập tên BM và chọn Page đại diện.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/bm-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId: selectedToken,
          name: bmName.trim(),
          primaryPage: bmPage,
          timezone: Number(bmTimezone),
          vertical: bmVertical,
          purposeConfirmed: true,
        }),
      });
      const data = await response.json() as { id?: string; name?: string; message?: string; error?: string };
      if (!response.ok) throw new Error(data.error || 'Tạo BM thất bại.');
      setMessage(data.message || `Đã tạo BM ${data.name || bmName} · ${data.id || ''}`);
      setBmName('');
      await checkOneToken(selectedToken);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  const topTabs = [
    { key: 'home' as const, label: 'HOME', icon: Home },
    { key: 'manage' as const, label: 'QUẢN LÝ TÀI NGUYÊN', icon: ShieldCheck },
    { key: 'create' as const, label: 'TẠO TÀI NGUYÊN', icon: Plus },
  ];

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}><Zap size={18} /><strong>ADS WORKSPACE</strong></div>
        <nav className={styles.topnav}>
          {topTabs.map((tab) => {
            const Icon = tab.icon;
            return <button key={tab.key} type="button" className={mode === tab.key ? styles.topActive : ''} onClick={() => void openMode(tab.key)}><Icon size={15} />{tab.label}</button>;
          })}
        </nav>
        <div className={styles.topStatus}><span className={liveTokens.length ? styles.liveDot : styles.deadDot} />{liveTokens.length}/{tokens.length} token LIVE</div>
      </header>

      {mode === 'home' && (
        <main className={styles.home}>
          <section className={styles.hero}>
            <span className={styles.kicker}>TOKEN-FIRST WORKSPACE</span>
            <h1>Nạp token một lần, quản lý tài nguyên ở đúng nơi.</h1>
            <p>Flow mới chỉ còn 3 bước: nạp token → check token & đọc tài nguyên → quản lý BM / ADS / Page hoặc dùng chính token đó để tạo thêm tài nguyên được hỗ trợ.</p>
            <div className={styles.heroActions}>
              <button type="button" onClick={() => { setCreateTab('token'); void openMode('create'); }}><KeyRound size={17} /> Nạp & check token</button>
              <button type="button" className={styles.secondary} onClick={() => void openMode('manage')}><ShieldCheck size={17} /> Quản lý tài nguyên</button>
            </div>
          </section>
          <section className={styles.flowGrid}>
            <article><KeyRound /><strong>1. Nạp token</strong><span>TXT, CSV, JSON, URL, token=…, tên|token.</span></article>
            <article><BadgeCheck /><strong>2. Check & phân loại</strong><span>LIVE/DIE, quyền, BM, ADS, Page và trạng thái tài nguyên.</span></article>
            <article><Sparkles /><strong>3. Dùng ngay</strong><span>BM vào BM, TKQC vào ADS, Page vào PAGE. Tạo BM dùng token đã chọn.</span></article>
          </section>
        </main>
      )}

      {mode === 'manage' && (
        <div className={styles.workspace}>
          <aside className={styles.sidebar}>
            <div className={styles.sideTitle}><ShieldCheck size={18} /><div><strong>QUẢN LÝ TÀI NGUYÊN</strong><small>BM · ADS · PAGE</small></div></div>
            {(Object.keys(RESOURCE_META) as ResourceTab[]).map((key) => {
              const item = RESOURCE_META[key];
              const Icon = item.icon;
              const count = key === 'BM' ? stats.bm : key === 'TKQC' ? stats.ads : stats.pages;
              return <button key={key} type="button" className={resourceTab === key ? styles.sideActive : ''} onClick={() => { setResourceTab(key); setSelectedIds([]); }}><span><Icon size={17} /></span><strong>{item.label}</strong><em>{count}</em><ChevronRight size={14} /></button>;
            })}
            <div className={styles.sideNote}>Group đã được bỏ khỏi khu vực quản lý tài nguyên theo yêu cầu.</div>
          </aside>

          <main className={styles.content}>
            <div className={styles.pageHead}>
              <div><span className={styles.kicker}>RESOURCE MANAGER</span><h2>{RESOURCE_META[resourceTab].label}</h2><p>Danh sách được đồng bộ trực tiếp từ token đã check.</p></div>
              <div className={styles.actions}><button type="button" className={styles.ghost} onClick={() => void refreshAll()} disabled={loading}><RefreshCw size={15} /> Làm mới</button><button type="button" onClick={() => void syncCurrentToken()} disabled={busy || !selectedToken}><RefreshCw size={15} /> Đồng bộ token</button></div>
            </div>

            {message && <div className={styles.success}><CheckCircle2 size={16} />{message}<button type="button" onClick={() => setMessage('')}><X size={14} /></button></div>}
            {error && <div className={styles.error}>{error}<button type="button" onClick={() => setError('')}><X size={14} /></button></div>}
            {progress && <div className={styles.progress}><LoaderCircle className={styles.spin} size={16} />{progress}</div>}

            <div className={styles.toolbar}>
              <label className={styles.search}><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Tìm ${RESOURCE_META[resourceTab].label}…`} /></label>
              <select value={selectedToken} onChange={(event) => { setSelectedToken(event.target.value); setSelectedIds([]); }}>
                <option value="">Tất cả token</option>
                {tokens.map((token) => <option key={token.id} value={token.id}>{token.label} · {STATUS_TEXT[token.status]}</option>)}
              </select>
              <button type="button" className={styles.ghost} onClick={() => void healthSelected()} disabled={busy || filteredAssets.length === 0}><ShieldCheck size={15} /> Check {selectedIds.length ? selectedIds.length : 'all'}</button>
            </div>

            <div className={styles.tableCard}>
              <table>
                <thead><tr><th className={styles.checkCol}></th><th>Tên</th><th>ID</th><th>Trạng thái</th>{resourceTab === 'BM' && <th>Xác minh</th>}{resourceTab === 'TKQC' && <><th>Tiền tệ</th><th>Limit</th></>}{resourceTab === 'Page' && <th>BM liên kết</th>}<th>Check gần nhất</th></tr></thead>
                <tbody>
                  {filteredAssets.map((asset) => (
                    <tr key={asset.id}>
                      <td><input type="checkbox" checked={selectedIds.includes(asset.id)} onChange={() => toggleSelected(asset.id)} /></td>
                      <td><strong>{asset.name}</strong><small>{asset.healthNote || ''}</small></td>
                      <td>{metaId(asset)}</td>
                      <td><span className={asset.status === 'LIVE' || asset.status === 'Truy cập được' ? styles.statusLive : asset.status === 'DIE' ? styles.statusDie : styles.statusWarn}>{asset.status}</span></td>
                      {resourceTab === 'BM' && <td>{asset.verified ? 'Đã xác minh' : asset.verificationStatus || 'Chưa rõ'}</td>}
                      {resourceTab === 'TKQC' && <><td>{asset.currency || '—'}</td><td>{asset.limit || '—'}</td></>}
                      {resourceTab === 'Page' && <td>{asset.parent ? assets.find((item) => item.id === asset.parent)?.name || '—' : '—'}</td>}
                      <td>{asset.checked ? new Date(asset.checked).toLocaleString('vi-VN') : '—'}</td>
                    </tr>
                  ))}
                  {!filteredAssets.length && <tr><td colSpan={8}><div className={styles.empty}><ShieldCheck size={28} /><strong>Chưa có {RESOURCE_META[resourceTab].label}</strong><span>Vào “Tạo tài nguyên → Nạp & check token”, sau đó tài nguyên sẽ tự đi vào đúng mục này.</span></div></td></tr>}
                </tbody>
              </table>
            </div>
          </main>
        </div>
      )}

      {mode === 'create' && (
        <div className={styles.workspace}>
          <aside className={styles.sidebar}>
            <div className={styles.sideTitle}><Plus size={18} /><div><strong>TẠO TÀI NGUYÊN</strong><small>Token & logic app cũ</small></div></div>
            <button type="button" className={createTab === 'token' ? styles.sideActive : ''} onClick={() => setCreateTab('token')}><span><KeyRound size={17} /></span><strong>Nạp & check token</strong><ChevronRight size={14} /></button>
            <button type="button" className={createTab === 'bm' ? styles.sideActive : ''} onClick={() => setCreateTab('bm')}><span><Building2 size={17} /></span><strong>Tạo BM từ token</strong><ChevronRight size={14} /></button>
            <button type="button" className={createTab === 'legacy' ? styles.sideActive : ''} onClick={() => setCreateTab('legacy')}><span><Sparkles size={17} /></span><strong>Toàn bộ logic app cũ</strong><ChevronRight size={14} /></button>
            <div className={styles.sideNote}>App cũ chỉ được tải khi bạn mở mục “Toàn bộ logic app cũ”, nên không chạy ngầm làm chậm app.</div>
          </aside>

          <main className={styles.content}>
            {message && <div className={styles.success}><CheckCircle2 size={16} />{message}<button type="button" onClick={() => setMessage('')}><X size={14} /></button></div>}
            {error && <div className={styles.error}>{error}<button type="button" onClick={() => setError('')}><X size={14} /></button></div>}
            {progress && <div className={styles.progress}><LoaderCircle className={styles.spin} size={16} />{progress}</div>}

            {createTab === 'token' && (
              <>
                <div className={styles.pageHead}><div><span className={styles.kicker}>TOKEN CENTER</span><h2>Nạp token → check → tự đồng bộ tài nguyên</h2><p>Không cần đi qua màn hình OAuth của app. Token được gửi về backend, mã hóa và chỉ dùng khi bạn bấm thao tác.</p></div><button type="button" className={styles.ghost} onClick={() => void refreshAll()}><RefreshCw size={15} /> Làm mới</button></div>
                <div className={styles.tokenImport}>
                  <div>
                    <label>Token / danh sách token</label>
                    <textarea value={tokenText} onChange={(event) => setTokenText(event.target.value)} placeholder={'Dán token trực tiếp\nhoặc tên|token\nhoặc token=...\nhoặc JSON / URL có access_token'} />
                  </div>
                  <div className={styles.fileBox} onClick={() => fileInputRef.current?.click()}><FileUp size={28} /><strong>{fileName || 'Chọn file token'}</strong><span>Nhận TXT, CSV, JSON và file text không có đuôi.</span><input ref={fileInputRef} type="file" onChange={(event) => void onTokenFile(event.target.files?.[0] || null)} /></div>
                  <button type="button" onClick={() => void importCheckAndSync()} disabled={busy}><BadgeCheck size={17} /> Nạp + Check + Đồng bộ</button>
                </div>

                <div className={styles.tokenList}>
                  <div className={styles.sectionHead}><div><strong>Kho token</strong><span>{tokens.length} token · {liveTokens.length} LIVE</span></div></div>
                  {tokens.map((token) => (
                    <div key={token.id} className={styles.tokenRow}>
                      <div className={styles.tokenName}><span className={token.status === 'active' ? styles.liveDot : styles.deadDot} /><div><strong>{token.label}</strong><small>{token.metaUserName || token.inventory?.metaUserName || 'Chưa đọc được user'}</small></div></div>
                      <span className={token.status === 'active' ? styles.statusLive : token.status === 'invalid' ? styles.statusDie : styles.statusWarn}>{STATUS_TEXT[token.status]}</span>
                      <div className={styles.resourceMini}><span>BM <b>{token.inventory?.businessCount || 0}</b></span><span>ADS <b>{token.inventory?.adAccountCount || 0}</b></span><span>Page <b>{token.inventory?.pageCount || 0}</b></span></div>
                      <button type="button" className={styles.ghost} disabled={busy} onClick={() => { setSelectedToken(token.id); void checkOneToken(token.id); }}><BadgeCheck size={14} /> Check token</button>
                    </div>
                  ))}
                  {!tokens.length && <div className={styles.empty}><KeyRound size={28} /><strong>Chưa có token</strong><span>Nạp token ở phía trên. Sau khi check LIVE, tài nguyên sẽ tự vào BM / ADS / PAGE.</span></div>}
                </div>
              </>
            )}

            {createTab === 'bm' && (
              <>
                <div className={styles.pageHead}><div><span className={styles.kicker}>RESOURCE CREATE</span><h2>Tạo BM bằng token đã nạp</h2><p>Chọn token LIVE, đọc Page của token rồi tạo BM. Không cần nhập token lại.</p></div></div>
                <div className={styles.formCard}>
                  <label>Token nguồn<select value={selectedToken} onChange={(event) => { setSelectedToken(event.target.value); setBmPages([]); setBmPage(''); setBmReady(false); }}><option value="">Chọn token</option>{tokens.map((token) => <option key={token.id} value={token.id}>{token.label} · {STATUS_TEXT[token.status]}</option>)}</select></label>
                  <div className={styles.permissionStrip}><span className={currentToken?.status === 'active' ? styles.statusLive : styles.statusWarn}>{currentToken ? STATUS_TEXT[currentToken.status] : 'Chưa chọn token'}</span>{currentPermissions.length ? currentPermissions.map((permission) => <span key={permission}>✓ {permission}</span>) : <span>Chưa đọc được quyền — hãy Check token</span>}</div>
                  <button type="button" className={styles.ghost} onClick={() => void loadBmPages()} disabled={busy || !selectedToken}><RefreshCw size={15} /> Đọc Page của token</button>
                  <div className={styles.formGrid}>
                    <label>Tên BM<input value={bmName} onChange={(event) => setBmName(event.target.value)} placeholder="Ví dụ: Brand Workspace 01" /></label>
                    <label>Page đại diện<select value={bmPage} onChange={(event) => setBmPage(event.target.value)}><option value="">Chọn Page</option>{bmPages.map((page) => <option key={page.id} value={page.id}>{page.name} · {page.id}</option>)}</select></label>
                    <label>Timezone ID<input value={bmTimezone} onChange={(event) => setBmTimezone(event.target.value.replace(/\D/g, ''))} /></label>
                    <label>Vertical<select value={bmVertical} onChange={(event) => setBmVertical(event.target.value)}><option value="ADVERTISING">Advertising</option><option value="ECOMMERCE">Ecommerce</option><option value="MARKETING">Marketing</option><option value="TECHNOLOGY">Technology</option><option value="RETAIL">Retail</option><option value="OTHER">Other</option></select></label>
                  </div>
                  <button type="button" onClick={() => void createBm()} disabled={busy || !bmReady || !bmName.trim() || !bmPage}><Plus size={16} /> Tạo BM</button>
                  {!bmReady && <small>Đọc Page của token trước. Nút tạo chỉ bật khi token có quyền cần thiết và có Page phù hợp.</small>}
                </div>
              </>
            )}

            {createTab === 'legacy' && (
              <>
                <div className={styles.pageHead}><div><span className={styles.kicker}>LEGACY LOGIC</span><h2>Toàn bộ logic app cũ</h2><p>Giữ nguyên các luồng Hàng đợi, Preset, Workflow, CRM, OAuth, hướng dẫn và các công cụ trước đây. Module này chỉ tải khi bạn mở mục này.</p></div></div>
                <div className={styles.legacyFrame}><iframe title="Toàn bộ logic app cũ" src="/stable" /></div>
              </>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
