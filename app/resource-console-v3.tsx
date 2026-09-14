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
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  X,
  Zap,
} from 'lucide-react';
import type { Asset } from '../lib/data';
import styles from './unified-meta-workspace.module.css';

type Mode = 'home' | 'manage' | 'create';
type ResourceTab = 'BM' | 'TKQC' | 'Page';
type CreateTab = 'token' | 'bm' | 'crm';
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
  pixelCount?: number;
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
type Campaign = { id: string; name: string; status: string; effectiveStatus: string; objective: string; dailyBudget: string; lifetimeBudget: string };
type PagePost = { id: string; message: string; createdTime: string; permalinkUrl: string; isPublished: boolean };

type Billing = {
  id: string; name: string; accountStatus: number; disableReason: number; currency: string; balance: string;
  amountSpent: string; spendCap: string; hasFundingSource: boolean; fundingType: string; fundingDisplay: string;
};

const STATUS_TEXT: Record<TokenStatus, string> = {
  active: 'LIVE', invalid: 'DIE', permission_issue: 'Thiếu quyền', rate_limited: 'Rate limit',
  create_restricted: 'Giới hạn tạo', unknown_error: 'Chưa kiểm tra',
};

const RESOURCE_META: Record<ResourceTab, { label: string; icon: typeof Building2 }> = {
  BM: { label: 'BM', icon: Building2 }, TKQC: { label: 'ADS', icon: CreditCard }, Page: { label: 'PAGE', icon: Flag },
};

function metaId(asset: Asset) {
  return asset.metaId || asset.id.match(/meta:(\d{5,30})$/)?.[1] || asset.id.match(/(\d{5,30})$/)?.[1] || '';
}

function parseTokens(input: string) {
  const out: ImportItem[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown, label?: unknown) => {
    const token = String(raw ?? '').trim().replace(/^['"]|['"]$/g, '');
    if (token.length < 20 || token.length > 4096 || /\s/.test(token) || seen.has(token)) return;
    seen.add(token);
    const clean = String(label ?? '').trim().slice(0, 80);
    out.push({ token, label: clean || undefined });
  };
  try {
    const walk = (value: unknown, label = '') => {
      if (Array.isArray(value)) return value.forEach((item) => walk(item, label));
      if (!value || typeof value !== 'object') return;
      const row = value as Record<string, unknown>;
      const next = String(row.label ?? row.name ?? row.email ?? label);
      for (const [key, value] of Object.entries(row)) {
        if (/^(access_?token|token)$/i.test(key)) push(value, next);
        else if (value && typeof value === 'object') walk(value, next);
      }
    };
    walk(JSON.parse(input));
  } catch { /* text formats below */ }
  input.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    const url = line.match(/[?&]access_token=([^&#\s]+)/i);
    if (url) push(decodeURIComponent(url[1]));
    const named = line.match(/(?:access_?token|token)\s*[:=]\s*['"]?([^'"\s,;]+)/i);
    if (named) push(named[1]);
    const parts = line.split(/[|\t,;]/).map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1) push(parts.at(-1), parts.slice(0, -1).join(' ')); else push(line);
  });
  return out;
}

function decodeFile(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  return new TextDecoder('utf-8').decode(buffer);
}

export default function ResourceConsoleV3() {
  const [mode, setMode] = useState<Mode>('home');
  const [resourceTab, setResourceTab] = useState<ResourceTab>('BM');
  const [createTab, setCreateTab] = useState<CreateTab>('token');
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedToken, setSelectedToken] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [query, setQuery] = useState('');
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

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'EMPLOYEE'>('EMPLOYEE');
  const [billing, setBilling] = useState<Billing | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [pagePosts, setPagePosts] = useState<PagePost[]>([]);
  const [pageSummary, setPageSummary] = useState<Record<string, unknown> | null>(null);
  const [postMessage, setPostMessage] = useState('');
  const [crmConfigured, setCrmConfigured] = useState<boolean | null>(null);

  const liveTokens = useMemo(() => tokens.filter((token) => token.status === 'active'), [tokens]);
  const selectedAsset = useMemo(() => assets.find((asset) => asset.id === selectedAssetId) || null, [assets, selectedAssetId]);
  const effectiveTokenId = selectedAsset?.sourceTokenId || selectedToken;

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

  async function jsonFetch<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const data = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  async function loadTokens() {
    const data = await jsonFetch<{ tokens?: TokenRow[] }>('/api/token-runtime', { cache: 'no-store' });
    const next = data.tokens || [];
    setTokens(next);
    setSelectedToken((current) => current && next.some((token) => token.id === current)
      ? current : next.find((token) => token.status === 'active')?.id || next[0]?.id || '');
    return next;
  }

  async function loadAssets() {
    const data = await jsonFetch<{ assets?: Asset[] }>('/api/workspace', { cache: 'no-store' });
    const next = data.assets || [];
    setAssets(next);
    return next;
  }

  async function loadAll() {
    await Promise.all([loadTokens(), loadAssets()]);
  }

  async function openMode(next: Mode) {
    setMode(next); setMessage(''); setError(''); setSelectedIds([]); setSelectedAssetId('');
    if (next !== 'home') {
      setBusy(true);
      try {
        const nextTokens = await loadTokens();
        await loadAssets();
        if (next === 'create') {
          const unknown = nextTokens.filter((token) => token.status === 'unknown_error' || !token.inventory).map((token) => token.id).slice(0, 20);
          if (unknown.length) {
            setProgress(`Đang tự check ${unknown.length} token chưa có trạng thái…`);
            await jsonFetch('/api/token-runtime', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'scan', ids: unknown }) });
            await loadTokens();
          }
        }
      } catch (err) { setError((err as Error).message); }
      finally { setBusy(false); setProgress(''); }
    }
  }

  async function onTokenFile(file: File | null) {
    setFileName(file?.name || ''); setError('');
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setError('File token tối đa 5 MB.');
    setTokenText(decodeFile(await file.arrayBuffer()));
  }

  async function syncToken(tokenId: string) {
    const data = await jsonFetch<{ imported?: number; message?: string }>('/api/resource-create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import_token', tokenId }),
    });
    return data.imported || 0;
  }

  async function importCheckAndSync() {
    const items = parseTokens(tokenText);
    if (!items.length) return setError('Chưa tìm thấy token hợp lệ.');
    if (items.length > 200) return setError('Mỗi lượt tối đa 200 token.');
    setBusy(true); setError(''); setMessage('');
    try {
      const active = new Set<string>(); let imported = 0; let reused = 0; let resources = 0;
      for (let index = 0; index < items.length; index += 20) {
        const chunk = items.slice(index, index + 20);
        setProgress(`Đang check token ${index + 1}–${index + chunk.length}/${items.length}…`);
        const data = await jsonFetch<{ inventories?: Inventory[]; imported?: number; reused?: number }>('/api/token-runtime', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import', items: chunk }),
        });
        imported += data.imported || 0; reused += data.reused || 0;
        (data.inventories || []).filter((item) => item.status === 'active').forEach((item) => active.add(item.tokenId));
      }
      const ids = [...active];
      for (let i = 0; i < ids.length; i += 1) {
        setProgress(`Token LIVE ${i + 1}/${ids.length}: đồng bộ BM, ADS, Page…`);
        resources += await syncToken(ids[i]);
      }
      await loadAll();
      setTokenText(''); setFileName(''); if (fileInputRef.current) fileInputRef.current.value = '';
      setMessage(`Xong: ${items.length} token · mới ${imported} · dùng lại ${reused} · LIVE ${active.size} · ${resources} tài nguyên.`);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); setProgress(''); }
  }

  async function scanTokens(ids: string[]) {
    if (!ids.length) return;
    setBusy(true); setError('');
    try {
      for (let i = 0; i < ids.length; i += 20) {
        const chunk = ids.slice(i, i + 20);
        setProgress(`Check token ${i + 1}–${i + chunk.length}/${ids.length}…`);
        const data = await jsonFetch<{ inventories?: Inventory[] }>('/api/token-runtime', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'scan', ids: chunk }),
        });
        for (const item of data.inventories || []) if (item.status === 'active') await syncToken(item.tokenId);
      }
      await loadAll(); setMessage('Đã check token và đồng bộ lại tài nguyên của token LIVE.');
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); setProgress(''); }
  }

  async function health(ids: string[]) {
    if (!ids.length) return setError('Chưa chọn tài nguyên.');
    setBusy(true); setError('');
    try {
      const data = await jsonFetch<{ message?: string }>('/api/resource-health', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, tokenId: selectedToken || '' }),
      });
      await loadAssets(); setMessage(data.message || 'Đã check tài nguyên.');
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function pushCrm(ids: string[]) {
    const metaIds = ids.map((id) => assets.find((asset) => asset.id === id)).filter(Boolean).map((asset) => metaId(asset as Asset)).filter(Boolean);
    if (!metaIds.length) return setError('Không có tài nguyên phù hợp để đẩy CRM.');
    setBusy(true); setError('');
    try {
      let accepted = 0;
      for (let i = 0; i < metaIds.length; i += 100) {
        const data = await jsonFetch<{ accepted?: unknown[] }>('/api/crm-push', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metaIds: metaIds.slice(i, i + 100) }),
        });
        accepted += data.accepted?.length || 0;
      }
      await loadAssets(); setMessage(`Đã đẩy ${accepted}/${metaIds.length} tài nguyên sang CRM.`);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function checkCrm() {
    try {
      const data = await jsonFetch<{ configured?: boolean }>('/api/crm-push', { cache: 'no-store' });
      setCrmConfigured(Boolean(data.configured));
    } catch { setCrmConfigured(false); }
  }

  async function prepareBm() {
    if (!selectedToken) return setError('Chọn token LIVE trước.');
    setBusy(true); setError('');
    try {
      const data = await jsonFetch<{ pages?: PageItem[] }>('/api/business-manager?tokenId=' + encodeURIComponent(selectedToken), { cache: 'no-store' });
      setBmPages(data.pages || []); setBmPage(data.pages?.[0]?.id || ''); setBmReady(true);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function createBm() {
    if (!bmName.trim() || !bmPage) return setError('Nhập tên BM và chọn Page đại diện.');
    setBusy(true); setError('');
    try {
      const data = await jsonFetch<{ message?: string }>('/api/business-manager', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId: selectedToken, name: bmName, primaryPage: bmPage, timezone: Number(bmTimezone), vertical: bmVertical, adminEmail: '', purposeConfirmed: true }),
      });
      await syncToken(selectedToken); await loadAll(); setMessage(data.message || 'Đã tạo BM.'); setBmName('');
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function inviteBusinessUser() {
    if (!selectedAsset || selectedAsset.type !== 'BM' || !effectiveTokenId || !inviteEmail) return setError('Chọn BM, token và nhập email.');
    setBusy(true); setError('');
    try {
      const data = await jsonFetch<{ message?: string }>('/api/meta-token-ops', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'invite_business_user', tokenId: effectiveTokenId, businessId: metaId(selectedAsset), email: inviteEmail, role: inviteRole, purposeConfirmed: true }),
      });
      setMessage(data.message || 'Đã gửi lời mời.'); setInviteEmail('');
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function readBilling() {
    if (!selectedAsset || selectedAsset.type !== 'TKQC' || !effectiveTokenId) return;
    setBusy(true); setError('');
    try {
      const data = await jsonFetch<{ billing?: Billing }>('/api/meta-token-ops', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read_billing', tokenId: effectiveTokenId, adAccountId: metaId(selectedAsset) }),
      });
      setBilling(data.billing || null);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function loadCampaigns() {
    if (!selectedAsset || selectedAsset.type !== 'TKQC' || !effectiveTokenId) return;
    setBusy(true); setError('');
    try {
      const data = await jsonFetch<{ campaigns?: Campaign[] }>(`/api/campaign-ops?tokenId=${encodeURIComponent(effectiveTokenId)}&accountId=${encodeURIComponent(metaId(selectedAsset))}`, { cache: 'no-store' });
      setCampaigns(data.campaigns || []);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function changeCampaign(campaignId: string, status: 'ACTIVE' | 'PAUSED' | 'DELETED') {
    if (!selectedAsset || selectedAsset.type !== 'TKQC' || !effectiveTokenId) return;
    if (status === 'DELETED' && !window.confirm('Xóa campaign này?')) return;
    setBusy(true); setError('');
    try {
      await jsonFetch('/api/campaign-ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokenId: effectiveTokenId, accountId: metaId(selectedAsset), campaignId, status }) });
      await loadCampaigns();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function loadPageData() {
    if (!selectedAsset || selectedAsset.type !== 'Page' || !effectiveTokenId) return;
    setBusy(true); setError('');
    try {
      const data = await jsonFetch<{ page?: Record<string, unknown>; posts?: PagePost[] }>(`/api/page-ops?tokenId=${encodeURIComponent(effectiveTokenId)}&pageId=${encodeURIComponent(metaId(selectedAsset))}`, { cache: 'no-store' });
      setPageSummary(data.page || null); setPagePosts(data.posts || []);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function publishPagePost() {
    if (!selectedAsset || selectedAsset.type !== 'Page' || !effectiveTokenId || !postMessage.trim()) return setError('Nhập nội dung bài viết.');
    setBusy(true); setError('');
    try {
      await jsonFetch('/api/page-ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'publish', tokenId: effectiveTokenId, pageId: metaId(selectedAsset), message: postMessage }) });
      setPostMessage(''); await loadPageData(); setMessage('Đã đăng bài lên Page.');
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function deletePagePost(postId: string) {
    if (!selectedAsset || selectedAsset.type !== 'Page' || !effectiveTokenId || !window.confirm('Xóa bài viết này?')) return;
    setBusy(true); setError('');
    try {
      await jsonFetch('/api/page-ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_post', tokenId: effectiveTokenId, pageId: metaId(selectedAsset), postId }) });
      await loadPageData();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  function backupBm() {
    if (!selectedAsset || selectedAsset.type !== 'BM') return;
    const children = assets.filter((asset) => asset.parent === selectedAsset.id);
    const blob = new Blob([JSON.stringify({ business: selectedAsset, assets: children, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `bm-${metaId(selectedAsset)}-backup.json`; a.click(); URL.revokeObjectURL(url);
  }

  function renderDetail() {
    if (!selectedAsset) return <div style={{ padding: 18, color: '#7d8698', fontSize: 12 }}>Chọn một tài nguyên trong bảng để mở công cụ thật.</div>;
    const token = tokens.find((item) => item.id === effectiveTokenId);
    return <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div><strong>{selectedAsset.name}</strong><div style={{ color: '#8b94a6', fontSize: 10, marginTop: 4 }}>ID {metaId(selectedAsset)} · token {token?.label || 'chưa xác định'}</div></div>
      <button className={styles.ghost} onClick={() => void health([selectedAsset.id])} disabled={busy}><ShieldCheck size={14}/> Check trạng thái thật</button>
      <button className={styles.ghost} onClick={() => void pushCrm([selectedAsset.id])} disabled={busy}><Send size={14}/> Đẩy CRM</button>
      {selectedAsset.type === 'BM' && <>
        <button className={styles.ghost} onClick={backupBm}><FileUp size={14}/> Backup JSON</button>
        <div style={{ borderTop: '1px solid #edf1f5', paddingTop: 10 }}><strong style={{ fontSize: 11 }}>Thêm người vào BM</strong></div>
        <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="email@example.com" style={{ height: 36, border: '1px solid #dfe5ef', borderRadius: 8, padding: '0 9px' }}/>
        <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'ADMIN'|'EMPLOYEE')} style={{ height: 36, border: '1px solid #dfe5ef', borderRadius: 8, padding: '0 9px', background: '#fff' }}><option value="EMPLOYEE">EMPLOYEE</option><option value="ADMIN">ADMIN</option></select>
        <button className={styles.ghost} onClick={() => void inviteBusinessUser()} disabled={busy}><UserPlus size={14}/> Gửi lời mời</button>
      </>}
      {selectedAsset.type === 'TKQC' && <>
        <button className={styles.ghost} onClick={() => void readBilling()} disabled={busy}><CreditCard size={14}/> Đọc billing/funding</button>
        <button className={styles.ghost} onClick={() => void loadCampaigns()} disabled={busy}><Zap size={14}/> Quản lý Campaign</button>
        {billing && <div style={{ fontSize: 10, lineHeight: 1.7, background: '#f8fafd', padding: 10, borderRadius: 8 }}>Currency: {billing.currency || '—'}<br/>Spent: {billing.amountSpent || '—'}<br/>Balance: {billing.balance || '—'}<br/>Spend cap: {billing.spendCap || '—'}<br/>Funding: {billing.hasFundingSource ? billing.fundingDisplay || billing.fundingType || 'Có' : 'Chưa có'}</div>}
        {campaigns.length > 0 && <div style={{ display: 'grid', gap: 7 }}>{campaigns.map((camp) => <div key={camp.id} style={{ border: '1px solid #e4e9f2', borderRadius: 8, padding: 9 }}><strong style={{ fontSize: 10 }}>{camp.name}</strong><div style={{ fontSize: 9, color: '#8b94a6', margin: '4px 0' }}>{camp.effectiveStatus || camp.status}</div><div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}><button className={styles.ghost} onClick={() => void changeCampaign(camp.id,'ACTIVE')}>Bật</button><button className={styles.ghost} onClick={() => void changeCampaign(camp.id,'PAUSED')}>Dừng</button><button className={styles.ghost} onClick={() => void changeCampaign(camp.id,'DELETED')}><Trash2 size={12}/> Xóa</button></div></div>)}</div>}
      </>}
      {selectedAsset.type === 'Page' && <>
        <button className={styles.ghost} onClick={() => void loadPageData()} disabled={busy}><RefreshCw size={14}/> Đọc Page & bài viết</button>
        {pageSummary && <div style={{ fontSize: 10, lineHeight: 1.7, background: '#f8fafd', padding: 10, borderRadius: 8 }}>Followers: {String(pageSummary.followersCount || 0)} · Fans: {String(pageSummary.fanCount || 0)}<br/>Verification: {String(pageSummary.verificationStatus || '—')}</div>}
        <textarea value={postMessage} onChange={(e) => setPostMessage(e.target.value)} placeholder="Nội dung đăng Page" style={{ minHeight: 80, border: '1px solid #dfe5ef', borderRadius: 8, padding: 9, resize: 'vertical' }}/>
        <button className={styles.ghost} onClick={() => void publishPagePost()} disabled={busy}><Send size={14}/> Đăng bài</button>
        {pagePosts.slice(0,10).map((post) => <div key={post.id} style={{ border: '1px solid #e4e9f2', borderRadius: 8, padding: 9, fontSize: 10 }}><div>{post.message || '(không có text)'}</div><button className={styles.ghost} onClick={() => void deletePagePost(post.id)}><Trash2 size={12}/> Xóa bài</button></div>)}
      </>}
    </div>;
  }

  function renderManage() {
    const meta = RESOURCE_META[resourceTab]; const Icon = meta.icon;
    return <div className={styles.workspace}>
      <aside className={styles.sidebar}>
        <div className={styles.sideTitle}><ShieldCheck size={18}/><div><strong>QUẢN LÝ TÀI NGUYÊN</strong><small>BM · ADS · PAGE</small></div></div>
        {(Object.keys(RESOURCE_META) as ResourceTab[]).map((tab) => { const M = RESOURCE_META[tab]; const I = M.icon; const count = tab === 'BM' ? stats.bm : tab === 'TKQC' ? stats.ads : stats.pages; return <button key={tab} className={resourceTab===tab?styles.sideActive:''} onClick={() => { setResourceTab(tab); setSelectedIds([]); setSelectedAssetId(''); }}><span><I size={15}/></span><strong>{M.label}</strong><em>{count}</em><ChevronRight size={13}/></button>; })}
        <div className={styles.sideNote}>Mỗi nút trong khu vực này gọi backend thật bằng token nguồn của tài nguyên. Không hiển thị chức năng giả.</div>
      </aside>
      <main className={styles.content}>
        <div className={styles.pageHead}><div><div className={styles.kicker}>RESOURCE MANAGER</div><h2>{meta.label}</h2><p>Đọc và vận hành tài nguyên đã đồng bộ từ token.</p></div><div className={styles.actions}><button className={styles.secondary} onClick={() => void loadAll()}><RefreshCw size={14}/> Làm mới</button><button onClick={() => selectedToken && void syncToken(selectedToken).then(loadAssets)} disabled={!selectedToken||busy}><RefreshCw size={14}/> Đồng bộ token</button></div></div>
        {progress && <div className={styles.progress}><LoaderCircle className={styles.spin} size={14}/>{progress}</div>}{error && <div className={styles.error}>{error}<button onClick={()=>setError('')}><X size={14}/></button></div>}{message && <div className={styles.success}><CheckCircle2 size={14}/>{message}<button onClick={()=>setMessage('')}><X size={14}/></button></div>}
        <div className={styles.toolbar}><div className={styles.search}><Search size={14}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder={`Tìm ${meta.label}...`}/></div><select value={selectedToken} onChange={(e)=>setSelectedToken(e.target.value)}><option value="">Tất cả token</option>{tokens.map((token)=><option key={token.id} value={token.id}>{token.label} · {STATUS_TEXT[token.status]}</option>)}</select><button className={styles.ghost} onClick={()=>void health(selectedIds.length?selectedIds:filteredAssets.slice(0,100).map((a)=>a.id))} disabled={busy||!filteredAssets.length}>Check all</button><button className={styles.ghost} onClick={()=>void pushCrm(selectedIds.length?selectedIds:filteredAssets.slice(0,100).map((a)=>a.id))} disabled={busy||!filteredAssets.length}><Send size={13}/> CRM</button></div>
        <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) 310px', gap:12 }}>
          <div className={styles.tableCard}><table><thead><tr><th></th><th>Tên</th><th>ID</th><th>Trạng thái</th><th>Chi tiết</th><th>Check gần nhất</th></tr></thead><tbody>{filteredAssets.map((asset)=><tr key={asset.id} onClick={()=>setSelectedAssetId(asset.id)} style={{ cursor:'pointer', background:selectedAssetId===asset.id?'#f4f7ff':undefined }}><td><input type="checkbox" checked={selectedIds.includes(asset.id)} onClick={(e)=>e.stopPropagation()} onChange={(e)=>setSelectedIds((prev)=>e.target.checked?[...prev,asset.id]:prev.filter((id)=>id!==asset.id))}/></td><td><strong>{asset.name}</strong><small>{tokens.find((t)=>t.id===asset.sourceTokenId)?.label || ''}</small></td><td>{metaId(asset)}</td><td><span className={asset.status==='LIVE'||asset.status.includes('Truy cập')?styles.statusLive:asset.status==='DIE'?styles.statusDie:styles.statusWarn}>{asset.status}</span></td><td>{asset.type==='BM'?(asset.verificationStatus||'—'):asset.type==='TKQC'?`${asset.currency||''} ${asset.limit||''}`:asset.healthNote||'—'}</td><td>{asset.checked?new Date(asset.checked).toLocaleString('vi-VN'):'—'}</td></tr>)}</tbody></table>{!filteredAssets.length&&<div className={styles.empty}><Icon size={22}/><strong>Chưa có {meta.label}</strong><span>Nạp/check token rồi đồng bộ tài nguyên.</span></div>}</div>
          <aside style={{ background:'#fff', border:'1px solid #e0e6ef', borderRadius:12, minHeight:360, overflow:'auto' }}>{renderDetail()}</aside>
        </div>
      </main>
    </div>;
  }

  function renderTokenTab() {
    return <><div className={styles.pageHead}><div><div className={styles.kicker}>TOKEN CENTER</div><h2>Nạp token → check → đồng bộ tài nguyên</h2><p>Token được mã hóa phía server. Nạp lại token cũ cũng sẽ mã hóa lại bằng khóa hiện tại để tránh lỗi “chưa kiểm tra”.</p></div><div className={styles.actions}><button className={styles.secondary} onClick={()=>void scanTokens(tokens.map((t)=>t.id))} disabled={busy||!tokens.length}><RefreshCw size={14}/> Check tất cả token</button></div></div>
      <div className={styles.tokenImport}><div><label>Token / danh sách token</label><textarea value={tokenText} onChange={(e)=>setTokenText(e.target.value)} placeholder="Dán token, tên|token, CSV, JSON hoặc access_token=..."/></div><label className={styles.fileBox}><input ref={fileInputRef} type="file" onChange={(e)=>void onTokenFile(e.target.files?.[0]||null)}/><FileUp size={28}/><strong>{fileName||'Chọn file token'}</strong><span>Mọi file text; UTF-8/UTF-16.</span></label><button onClick={()=>void importCheckAndSync()} disabled={busy}><BadgeCheck size={15}/>{busy?'Đang xử lý…':'Nạp + Check + Đồng bộ'}</button></div>
      <div className={styles.tokenList}><div className={styles.sectionHead}><div><strong>Kho token</strong><span>{tokens.length} token · {liveTokens.length} LIVE</span></div></div>{tokens.map((token)=><div className={styles.tokenRow} key={token.id}><div className={styles.tokenName}><span className={token.status==='active'?styles.liveDot:styles.deadDot}/><div><strong>{token.metaUserName?`${token.metaUserName} - ${token.metaUserId||''}`:token.label}</strong><small>{token.lastError||token.inventory?.warnings?.[0]||'Đã đọc user/permissions/tài nguyên khi check.'}</small></div></div><span className={token.status==='active'?styles.statusLive:token.status==='invalid'?styles.statusDie:styles.statusWarn}>{STATUS_TEXT[token.status]}</span><div className={styles.resourceMini}><span>BM <b>{token.inventory?.businessCount||0}</b></span><span>ADS <b>{token.inventory?.adAccountCount||0}</b></span><span>Page <b>{token.inventory?.pageCount||0}</b></span></div><button className={styles.ghost} onClick={()=>void scanTokens([token.id])} disabled={busy}><ShieldCheck size={13}/> Check token</button></div>)}</div></>;
  }

  function renderBmCreate() {
    const current = tokens.find((t)=>t.id===selectedToken);
    return <><div className={styles.pageHead}><div><div className={styles.kicker}>RESOURCE CREATOR</div><h2>Tạo BM từ token</h2><p>Chọn token LIVE, lấy Page mà token quản lý rồi tạo BM.</p></div></div><div className={styles.formCard}><label>Token<select value={selectedToken} onChange={(e)=>{setSelectedToken(e.target.value);setBmReady(false);setBmPages([]);}}><option value="">Chọn token</option>{liveTokens.map((t)=><option key={t.id} value={t.id}>{t.label}</option>)}</select></label><div className={styles.permissionStrip}><span className={current?.status==='active'?styles.statusLive:styles.statusWarn}>{current?STATUS_TEXT[current.status]:'Chưa chọn'}</span>{current?.inventory?.permissions.slice(0,8).map((p)=><span key={p}>{p}</span>)}</div><button onClick={()=>void prepareBm()} disabled={busy||!selectedToken}><RefreshCw size={14}/> Đọc Page của token</button>{bmReady&&<div className={styles.formGrid}><label>Tên BM<input value={bmName} onChange={(e)=>setBmName(e.target.value)} placeholder="Tên Business"/></label><label>Page đại diện<select value={bmPage} onChange={(e)=>setBmPage(e.target.value)}>{bmPages.map((p)=><option key={p.id} value={p.id}>{p.name} · {p.id}</option>)}</select></label><label>Timezone ID<input value={bmTimezone} onChange={(e)=>setBmTimezone(e.target.value)}/></label><label>Vertical<select value={bmVertical} onChange={(e)=>setBmVertical(e.target.value)}><option>ADVERTISING</option><option>ECOMMERCE</option><option>MARKETING</option><option>TECHNOLOGY</option><option>OTHER</option></select></label></div>}{bmReady&&<button onClick={()=>void createBm()} disabled={busy||!bmName||!bmPage}><Plus size={14}/> Tạo BM</button>}</div></>;
  }

  function renderCrm() {
    return <><div className={styles.pageHead}><div><div className={styles.kicker}>CCRM / CRM</div><h2>Liên kết CRM</h2><p>Dùng lại gateway CRM cũ của app. BM, ADS và Page được đẩy qua /api/crm-push.</p></div><div className={styles.actions}><button className={styles.secondary} onClick={()=>void checkCrm()}><RefreshCw size={14}/> Kiểm tra kết nối</button></div></div><div className={styles.formCard}><div className={styles.permissionStrip}><span className={crmConfigured===true?styles.statusLive:styles.statusWarn}>{crmConfigured===null?'Chưa kiểm tra':crmConfigured?'CRM đã cấu hình':'Chưa có API key CRM'}</span></div><p style={{fontSize:11,color:'#6b7488'}}>CRM hiện nhận BM, TKQC và Page có Meta ID. Sau khi token được check/sync, bạn có thể đẩy tài nguyên từ Quản lý tài nguyên hoặc đẩy toàn bộ bên dưới.</p><button onClick={()=>void pushCrm(assets.filter((a)=>['BM','TKQC','Page'].includes(a.type)).slice(0,100).map((a)=>a.id))} disabled={busy||!assets.length}><Send size={14}/> Đẩy tối đa 100 tài nguyên hiện có</button></div></>;
  }

  function renderCreate() {
    return <div className={styles.workspace}><aside className={styles.sidebar}><div className={styles.sideTitle}><Plus size={18}/><div><strong>TẠO TÀI NGUYÊN</strong><small>Token & logic app cũ đã gom lại</small></div></div><button className={createTab==='token'?styles.sideActive:''} onClick={()=>setCreateTab('token')}><span><KeyRound size={15}/></span><strong>Nạp & check token</strong><ChevronRight size={13}/></button><button className={createTab==='bm'?styles.sideActive:''} onClick={()=>setCreateTab('bm')}><span><Building2 size={15}/></span><strong>Tạo BM từ token</strong><ChevronRight size={13}/></button><button className={createTab==='crm'?styles.sideActive:''} onClick={()=>{setCreateTab('crm');void checkCrm();}}><span><Send size={15}/></span><strong>Liên kết CRM</strong><ChevronRight size={13}/></button><div className={styles.sideNote}>Không còn “Toàn bộ logic app cũ”. Các logic thật được đưa vào đúng màn hình; module không dùng sẽ không chạy nền.</div></aside><main className={styles.content}>{progress&&<div className={styles.progress}><LoaderCircle className={styles.spin} size={14}/>{progress}</div>}{error&&<div className={styles.error}>{error}<button onClick={()=>setError('')}><X size={14}/></button></div>}{message&&<div className={styles.success}><CheckCircle2 size={14}/>{message}<button onClick={()=>setMessage('')}><X size={14}/></button></div>}{createTab==='token'?renderTokenTab():createTab==='bm'?renderBmCreate():renderCrm()}</main></div>;
  }

  if (mode === 'home') return <div className={styles.shell}><TopBar mode={mode} live={liveTokens.length} total={tokens.length} onMode={(next)=>void openMode(next)}/><main className={styles.home}><section className={styles.hero}><div className={styles.kicker}>ADS WORKSPACE</div><h1>Token → tài nguyên → vận hành thật</h1><p>Nạp token một lần, app check LIVE/DIE và quyền, đồng bộ BM/ADS/Page, rồi mở đúng công cụ quản lý thực tế. CRM cũ được nối lại, còn module giả/không có backend đã bị loại.</p><div className={styles.heroActions}><button onClick={()=>void openMode('create')}><Plus size={15}/> Nạp token</button><button className={styles.secondary} onClick={()=>void openMode('manage')}><ShieldCheck size={15}/> Quản lý tài nguyên</button></div></section><div className={styles.flowGrid}><article><KeyRound size={18}/><strong>1. Check token</strong><span>/me thành công = LIVE; quyền/tài nguyên phụ được đọc riêng, không làm token LIVE thành DIE chỉ vì thiếu một scope.</span></article><article><Building2 size={18}/><strong>2. Gom tài nguyên</strong><span>BM, tài khoản quảng cáo, Page được đồng bộ và gắn đúng token nguồn.</span></article><article><Sparkles size={18}/><strong>3. Vận hành</strong><span>Check health, invite BM user, billing, campaign, Page post và CRM đều gọi backend thật.</span></article></div></main></div>;
  return <div className={styles.shell}><TopBar mode={mode} live={liveTokens.length} total={tokens.length} onMode={(next)=>void openMode(next)}/>{mode==='manage'?renderManage():renderCreate()}</div>;
}

function TopBar({ mode, live, total, onMode }: { mode: Mode; live: number; total: number; onMode: (mode: Mode)=>void }) {
  return <header className={styles.topbar}><div className={styles.brand}><Zap size={17}/><strong>ADS WORKSPACE</strong></div><nav className={styles.topnav}><button className={mode==='home'?styles.topActive:''} onClick={()=>onMode('home')}><Home size={14}/> HOME</button><button className={mode==='manage'?styles.topActive:''} onClick={()=>onMode('manage')}><ShieldCheck size={14}/> QUẢN LÝ TÀI NGUYÊN</button><button className={mode==='create'?styles.topActive:''} onClick={()=>onMode('create')}><Plus size={14}/> TẠO TÀI NGUYÊN</button></nav><div className={styles.topStatus}><span className={live?styles.liveDot:styles.deadDot}/>{live}/{total} token LIVE</div></header>;
}
