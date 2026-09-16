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
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import type { Asset } from '../lib/data';
import styles from './unified-meta-workspace.module.css';

type Mode = 'home' | 'manage' | 'create';
type ResourceTab = 'BM' | 'TKQC' | 'Page';
type CreateTab = 'token' | 'bm' | 'crm';
type TokenStatus = 'active' | 'invalid' | 'permission_issue' | 'rate_limited' | 'create_restricted' | 'unknown_error';
type RunKind =
  | 'health'
  | 'sync'
  | 'crm'
  | 'open'
  | 'refresh'
  | 'billing'
  | 'campaigns'
  | 'renameAd'
  | 'spendCap'
  | 'renameBusiness'
  | 'inviteUser'
  | 'backup'
  | 'claimPage'
  | 'systemUser'
  | 'pageRead'
  | 'pagePost'
  | 'pagePublish'
  | 'pageUnpublish'
  | 'pageInfo'
  | 'unsupported';

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
  lastCheckedAt?: string;
  inventory: Inventory | null;
};

type ImportItem = { label?: string; token: string };
type PageItem = { id: string; name: string; tasks?: string[] };
type Campaign = {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  objective: string;
  dailyBudget: string;
  lifetimeBudget: string;
};
type PagePost = { id: string; message: string; createdTime: string; permalinkUrl: string; isPublished: boolean };
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
type ActionItem = { id: string; title: string; kind: RunKind; danger?: boolean; note?: string };

const STATUS_TEXT: Record<TokenStatus, string> = {
  active: 'LIVE',
  invalid: 'DIE',
  permission_issue: 'API không nhận',
  rate_limited: 'Rate limit',
  create_restricted: 'Giới hạn tạo',
  unknown_error: 'Chưa kiểm tra',
};

const RESOURCE_META: Record<ResourceTab, { label: string; icon: typeof Building2 }> = {
  BM: { label: 'BM', icon: Building2 },
  TKQC: { label: 'ADS', icon: CreditCard },
  Page: { label: 'PAGE', icon: Flag },
};

const ADS_TOOLS: ActionItem[] = [
  { id: 'check', title: 'Check trạng thái', kind: 'refresh' },
  { id: 'billing', title: 'Đọc billing / funding', kind: 'billing' },
  { id: 'campaigns', title: 'Quản lý Camp', kind: 'campaigns' },
  { id: 'rename', title: 'Đổi tên tài khoản', kind: 'renameAd' },
  { id: 'spend', title: 'Giới hạn chi tiêu', kind: 'spendCap' },
  { id: 'open', title: 'Mở Ads Manager', kind: 'open' },
  { id: 'crm', title: 'Đẩy CRM', kind: 'crm' },
  { id: 'prepay', title: 'Kích hoạt trả trước', kind: 'unsupported' },
  { id: 'add-card', title: 'Add thẻ', kind: 'unsupported' },
  { id: 'add-user', title: 'Thêm người', kind: 'unsupported' },
  { id: 'delete-draft', title: 'Xóa Camp, Nháp', kind: 'unsupported' },
  { id: 'invoice', title: 'Tải hóa đơn', kind: 'unsupported' },
  { id: 'leave', title: 'Thoát tài khoản', kind: 'unsupported' },
  { id: 'share-partner', title: 'Share đối tác BM', kind: 'unsupported' },
  { id: 'share-pixel', title: 'Share Pixel', kind: 'unsupported' },
  { id: 'phone', title: 'Xác minh phone', kind: 'unsupported' },
];

const BM_TOOLS: ActionItem[] = [
  { id: 'check', title: 'Check BM', kind: 'refresh' },
  { id: 'invite', title: 'Thêm người', kind: 'inviteUser' },
  { id: 'backup', title: 'Backup BM', kind: 'backup' },
  { id: 'rename', title: 'Đổi thông tin BM', kind: 'renameBusiness' },
  { id: 'claim-page', title: 'Thêm Page', kind: 'claimPage' },
  { id: 'system-user', title: 'Thêm Business System User', kind: 'systemUser' },
  { id: 'open', title: 'Mở Business Settings', kind: 'open' },
  { id: 'crm', title: 'Đẩy CRM', kind: 'crm' },
  { id: 'bm3', title: 'Kích BM3', kind: 'unsupported' },
  { id: 'card', title: 'Add thẻ', kind: 'unsupported' },
  { id: 'asset-group', title: 'Nhóm tài sản BM', kind: 'unsupported' },
  { id: 'cancel-invite', title: 'Hủy lời mời', kind: 'unsupported' },
  { id: 'remove-asset', title: 'Xóa tài sản khỏi BM', kind: 'unsupported' },
  { id: 'partner', title: 'Xóa đối tác', kind: 'unsupported' },
  { id: 'remove-ad', title: 'Xóa TKQC', kind: 'unsupported' },
  { id: 'permissions', title: 'Cập nhật quyền', kind: 'unsupported' },
];

const PAGE_TOOLS: ActionItem[] = [
  { id: 'check', title: 'Check Page', kind: 'refresh' },
  { id: 'read', title: 'Đọc Page & bài viết', kind: 'pageRead' },
  { id: 'post', title: 'Đăng bài trang', kind: 'pagePost' },
  { id: 'unpublish', title: 'Hủy đăng Page', kind: 'pageUnpublish', danger: true },
  { id: 'republish', title: 'Kích hoạt lại Page', kind: 'pagePublish' },
  { id: 'info', title: 'Đổi thông tin Page', kind: 'pageInfo' },
  { id: 'open', title: 'Mở Page', kind: 'open' },
  { id: 'crm', title: 'Đẩy CRM', kind: 'crm' },
  { id: 'partner', title: 'Thêm đối tác', kind: 'unsupported' },
  { id: 'add-bm', title: 'Add Page vào BM', kind: 'unsupported' },
  { id: 'assign-bm', title: 'Chỉ định Page BM', kind: 'unsupported' },
  { id: 'avatar', title: 'Đổi Avatar & Cover', kind: 'unsupported' },
  { id: 'delete-posts', title: 'Xóa bài viết hàng loạt', kind: 'unsupported' },
  { id: 'leave', title: 'Thoát Page', kind: 'unsupported' },
  { id: 'remove-admin', title: 'Xóa QTV Page', kind: 'unsupported' },
  { id: 'rename', title: 'Đổi tên Page', kind: 'unsupported' },
  { id: 'share', title: 'Share Page', kind: 'unsupported' },
];

function metaId(asset: Asset) {
  return asset.metaId || asset.id.match(/meta:(\d{5,30})$/)?.[1] || asset.id.match(/(\d{5,30})$/)?.[1] || '';
}

function cleanTokenCandidate(value: unknown) {
  return String(value ?? '')
    .replace(/^\s*Bearer\s+/i, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function parseTokens(input: string) {
  const out: ImportItem[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown, label?: unknown) => {
    const token = cleanTokenCandidate(raw);
    if (token.length < 20 || token.length > 4096 || seen.has(token)) return;
    seen.add(token);
    const clean = String(label ?? '').trim().slice(0, 80);
    out.push({ token, label: clean || undefined });
  };
  try {
    const walk = (value: unknown, label = ''): void => {
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
  } catch { /* text parser below */ }
  for (const match of input.matchAll(/(?:access_?token|token)\s*[:=]\s*['"]?([^'"\s,;]+)/gi)) push(match[1]);
  for (const match of input.matchAll(/[?&]access_token=([^&#\s]+)/gi)) push(decodeURIComponent(match[1]));
  let wrapped = '';
  const flush = () => { if (wrapped) push(wrapped); wrapped = ''; };
  input.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) { flush(); return; }
    if (/[|\t,;:=]/.test(line)) {
      flush();
      const parts = line.split(/[|\t,;]/).map((part) => part.trim()).filter(Boolean);
      if (parts.length > 1) push(parts.at(-1), parts.slice(0, -1).join(' '));
      return;
    }
    const compact = cleanTokenCandidate(line);
    if (/^[A-Za-z0-9._-]{20,}$/.test(compact)) {
      if (!wrapped || /^EAA/i.test(compact)) { flush(); wrapped = compact; }
      else wrapped += compact;
    }
  });
  flush();
  return out;
}

function decodeFile(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  return new TextDecoder('utf-8').decode(buffer);
}

function statusClass(status: string) {
  if (status === 'LIVE' || status === 'active' || status.includes('Truy cập')) return styles.statusLive;
  if (status === 'DIE' || status === 'invalid') return styles.statusDie;
  return styles.statusWarn;
}

function currentTools(tab: ResourceTab) {
  if (tab === 'BM') return BM_TOOLS;
  if (tab === 'TKQC') return ADS_TOOLS;
  return PAGE_TOOLS;
}

export default function ResourceConsoleV5() {
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
  const [billing, setBilling] = useState<Billing | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [pagePosts, setPagePosts] = useState<PagePost[]>([]);
  const [pageSummary, setPageSummary] = useState<Record<string, unknown> | null>(null);
  const [postMessage, setPostMessage] = useState('');
  const [crmConfigured, setCrmConfigured] = useState<boolean | null>(null);

  const liveTokens = useMemo(() => tokens.filter((token) => token.status === 'active'), [tokens]);
  const selectedAsset = useMemo(() => assets.find((asset) => asset.id === selectedAssetId) || null, [assets, selectedAssetId]);
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
    BM: assets.filter((asset) => asset.type === 'BM').length,
    TKQC: assets.filter((asset) => asset.type === 'TKQC').length,
    Page: assets.filter((asset) => asset.type === 'Page').length,
  }), [assets]);

  async function jsonFetch<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const data = await response.json() as T & { error?: string; message?: string };
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  async function loadTokens() {
    const data = await jsonFetch<{ tokens?: TokenRow[] }>('/api/token-runtime', { cache: 'no-store' });
    const next = data.tokens || [];
    setTokens(next);
    setSelectedToken((current) => current && next.some((token) => token.id === current) ? current : next.find((token) => token.status === 'active')?.id || next[0]?.id || '');
    return next;
  }

  async function loadAssets() {
    const data = await jsonFetch<{ assets?: Asset[] }>('/api/workspace', { cache: 'no-store' });
    const next = data.assets || [];
    setAssets(next);
    return next;
  }

  async function loadAll() { await Promise.all([loadTokens(), loadAssets()]); }

  async function openMode(next: Mode) {
    setMode(next); setMessage(''); setError(''); setSelectedIds([]); setSelectedAssetId('');
    if (next === 'home') return;
    setBusy(true);
    try { await loadAll(); } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function onTokenFile(file: File | null) {
    setFileName(file?.name || ''); setError('');
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('File token tối đa 5 MB.'); return; }
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
    if (!items.length) { setError('Chưa tìm thấy token hợp lệ. Dán nguyên khối token/cả file extension vào ô này.'); return; }
    if (items.length > 200) { setError('Mỗi lượt tối đa 200 token.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const active = new Set<string>(); let imported = 0; let reused = 0; let resources = 0; let rejected = 0;
      const syncErrors: string[] = [];
      for (let index = 0; index < items.length; index += 20) {
        const chunk = items.slice(index, index + 20);
        setProgress(`Đang check token ${index + 1}–${index + chunk.length}/${items.length}…`);
        const data = await jsonFetch<{ inventories?: Inventory[]; imported?: number; reused?: number }>('/api/token-runtime', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import', items: chunk }),
        });
        imported += data.imported || 0; reused += data.reused || 0;
        for (const item of data.inventories || []) {
          if (item.status === 'active') active.add(item.tokenId);
          if (item.status === 'permission_issue') rejected += 1;
        }
      }
      const ids = [...active];
      for (let i = 0; i < ids.length; i += 1) {
        setProgress(`Token LIVE ${i + 1}/${ids.length}: đồng bộ tài nguyên…`);
        try { resources += await syncToken(ids[i]); }
        catch (syncError) { syncErrors.push((syncError as Error).message); }
      }
      await loadAll(); setTokenText(''); setFileName(''); if (fileInputRef.current) fileInputRef.current.value = '';
      setMessage(`Xong: ${items.length} token · mới ${imported} · dùng lại ${reused} · LIVE ${active.size} · API không nhận ${rejected} · ${resources} tài nguyên.${syncErrors.length ? ` ${syncErrors.length} token chưa đồng bộ xong.` : ''}`);
      if (syncErrors.length) setError(`Đồng bộ tài nguyên: ${syncErrors[0]}`);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); setProgress(''); }
  }

  async function scanTokens(ids: string[]) {
    if (!ids.length) return;
    setBusy(true); setError(''); setMessage('');
    try {
      let activeCount = 0;
      let rejectedCount = 0;
      const syncErrors: string[] = [];
      for (let i = 0; i < ids.length; i += 20) {
        const chunk = ids.slice(i, i + 20);
        setProgress(`Check token ${i + 1}–${i + chunk.length}/${ids.length}…`);
        const data = await jsonFetch<{ inventories?: Inventory[] }>('/api/token-runtime', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'scan', ids: chunk }),
        });
        for (const item of data.inventories || []) {
          if (item.status === 'active') {
            activeCount += 1;
            try { await syncToken(item.tokenId); }
            catch (syncError) { syncErrors.push((syncError as Error).message); }
          }
          if (item.status === 'permission_issue') rejectedCount += 1;
        }
      }
      await loadAll(); setMessage(`Đã check xong: ${activeCount} LIVE, ${rejectedCount} token API không nhận.${syncErrors.length ? ` ${syncErrors.length} token chưa đồng bộ xong.` : ''}`);
      if (syncErrors.length) setError(`Đồng bộ tài nguyên: ${syncErrors[0]}`);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); setProgress(''); }
  }

  async function renameToken(token: TokenRow) {
    const label = window.prompt('Tên mới cho token:', token.label)?.trim();
    if (!label || label === token.label) return;
    setBusy(true); setError('');
    try {
      const data = await jsonFetch<{ tokens?: TokenRow[]; message?: string }>('/api/token-runtime', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rename', id: token.id, label }),
      });
      setTokens(data.tokens || []); setMessage(data.message || 'Đã sửa tên token.');
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function deleteToken(token: TokenRow) {
    if (!window.confirm(`Xóa token "${token.label}" và tài nguyên đồng bộ từ token này?`)) return;
    setBusy(true); setError('');
    try {
      const data = await jsonFetch<{ tokens?: TokenRow[]; message?: string }>('/api/token-runtime', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', ids: [token.id], purgeAssets: true }),
      });
      setTokens(data.tokens || []); await loadAssets(); setSelectedIds([]); setSelectedAssetId(''); setMessage(data.message || 'Đã xóa token.');
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function health(ids: string[]) {
    if (!ids.length) { setError('Chưa có tài nguyên để check.'); return; }
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
    if (!metaIds.length) { setError('Không có tài nguyên phù hợp để đẩy CRM.'); return; }
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
    setBusy(true); setError(''); setMessage('');
    try {
      const data = await jsonFetch<{ configured?: boolean; endpoint?: string }>('/api/crm-push', { cache: 'no-store' });
      setCrmConfigured(Boolean(data.configured));
      setMessage(data.configured ? `CRM đã kết nối: ${data.endpoint || 'gateway cũ'}` : 'CRM chưa có BVAGC_RESOURCE_API_KEY trong .env.local.');
    } catch (err) { setCrmConfigured(false); setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function runBackendAction(action: string, payload: Record<string, unknown> = {}) {
    if (!selectedAsset) { setError('Chọn một tài nguyên trong bảng trước khi chạy chức năng này.'); return; }
    const tokenId = selectedAsset.sourceTokenId || selectedToken;
    if (!tokenId) { setError('Tài nguyên này chưa có token nguồn. Hãy đồng bộ lại token.'); return; }
    const data = await jsonFetch<{ message?: string; url?: string }>('/api/resource-actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenId, assetId: selectedAsset.id, action, payload }),
    });
    if (data.url && action === 'open_official') window.open(data.url, '_blank', 'noopener,noreferrer');
    await loadAssets();
    setMessage(data.message || 'Đã chạy thao tác.');
  }

  async function runResourceAction(kind: RunKind, title: string) {
    const bulkIds = selectedIds.length ? selectedIds : filteredAssets.slice(0, 100).map((asset) => asset.id);
    if (kind === 'health') return health(bulkIds);
    if (kind === 'sync') return selectedToken ? syncToken(selectedToken).then(loadAssets) : setError('Chọn token trước.');
    if (kind === 'crm') return pushCrm(selectedAsset ? [selectedAsset.id] : bulkIds);
    setBusy(true); setError(''); setMessage('');
    try {
      if (kind === 'open') await runBackendAction('open_official');
      else if (kind === 'refresh') await runBackendAction('refresh');
      else if (kind === 'billing') await readBilling();
      else if (kind === 'campaigns') await loadCampaigns();
      else if (kind === 'renameAd') { const name = window.prompt('Tên TKQC mới:', selectedAsset?.name || '')?.trim(); if (name) await runBackendAction('rename_ad_account', { name }); }
      else if (kind === 'spendCap') { const spendCap = window.prompt('Giới hạn chi tiêu theo đơn vị API Meta, ví dụ 50000:', '')?.trim(); if (spendCap) await runBackendAction('set_spend_cap', { spendCap }); }
      else if (kind === 'renameBusiness') { const name = window.prompt('Tên BM mới:', selectedAsset?.name || '')?.trim(); if (name) await runBackendAction('rename_business', { name }); }
      else if (kind === 'inviteUser') await inviteBusinessUser();
      else if (kind === 'backup') backupBm();
      else if (kind === 'claimPage') { const pageId = window.prompt('Page ID cần thêm vào BM:', '')?.trim(); if (pageId) await runBackendAction('claim_page', { pageId }); }
      else if (kind === 'systemUser') { const name = window.prompt('Tên System User:', 'System User')?.trim(); if (name) await runBackendAction('create_system_user', { name, role: 'EMPLOYEE' }); }
      else if (kind === 'pageRead') await loadPageData();
      else if (kind === 'pagePost') await publishPagePost();
      else if (kind === 'pagePublish') await runBackendAction('publish_state', { state: 'true' });
      else if (kind === 'pageUnpublish') { if (window.confirm('Hủy đăng Page này?')) await runBackendAction('publish_state', { state: 'false' }); }
      else if (kind === 'pageInfo') {
        const about = window.prompt('About/giới thiệu mới:', '')?.trim();
        const website = window.prompt('Website mới, bỏ trống nếu không đổi:', '')?.trim();
        await runBackendAction('update_page_info', { about, website });
      } else {
        await runBackendAction('unsupported', { title });
      }
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function prepareBm() {
    if (!selectedToken) { setError('Chọn token LIVE trước.'); return; }
    setBusy(true); setError(''); setBmReady(false); setBmPages([]); setBmPage('');
    try {
      const data = await jsonFetch<{ pages?: PageItem[] }>('/api/business-manager?tokenId=' + encodeURIComponent(selectedToken), { cache: 'no-store' });
      const pages = data.pages || [];
      setBmPages(pages); setBmPage(pages[0]?.id || ''); setBmReady(pages.length > 0);
      if (!pages.length) setError('GET /me/accounts không trả Page để dùng làm primary_page.');
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function createBm() {
    if (!bmName.trim() || !bmPage) { setError('Nhập tên BM và chọn Page đại diện.'); return; }
    setBusy(true); setError('');
    try {
      const data = await jsonFetch<{ message?: string }>('/api/business-manager', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId: selectedToken, name: bmName, primaryPage: bmPage, timezone: Number(bmTimezone), vertical: bmVertical, adminEmail: '', purposeConfirmed: true }),
      });
      setMessage(data.message || 'Đã tạo BM.'); setBmName('');
      try {
        await syncToken(selectedToken);
      } catch (syncError) {
        setError(`BM đã được tạo trên Meta, nhưng đồng bộ tài nguyên chưa xong: ${(syncError as Error).message}`);
      }
      await loadAll();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function inviteBusinessUser() {
    if (!selectedAsset || selectedAsset.type !== 'BM') { setError('Chọn BM trước.'); return; }
    const email = window.prompt('Email người cần mời vào BM:', '')?.trim();
    if (!email) return;
    const role = window.confirm('Bấm OK để mời ADMIN, Cancel để mời EMPLOYEE') ? 'ADMIN' : 'EMPLOYEE';
    const data = await jsonFetch<{ message?: string }>('/api/meta-token-ops', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'invite_business_user', tokenId: selectedAsset.sourceTokenId || selectedToken, businessId: metaId(selectedAsset), email, role, purposeConfirmed: true }),
    });
    setMessage(data.message || 'Đã gửi lời mời.');
  }

  async function readBilling() {
    if (!selectedAsset || selectedAsset.type !== 'TKQC') { setError('Chọn tài khoản quảng cáo trước.'); return; }
    const data = await jsonFetch<{ billing?: Billing }>('/api/meta-token-ops', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'read_billing', tokenId: selectedAsset.sourceTokenId || selectedToken, adAccountId: metaId(selectedAsset) }),
    });
    setBilling(data.billing || null); setMessage('Đã đọc billing/funding source.');
  }

  async function loadCampaigns() {
    if (!selectedAsset || selectedAsset.type !== 'TKQC') { setError('Chọn tài khoản quảng cáo trước.'); return; }
    const data = await jsonFetch<{ campaigns?: Campaign[] }>(`/api/campaign-ops?tokenId=${encodeURIComponent(selectedAsset.sourceTokenId || selectedToken)}&accountId=${encodeURIComponent(metaId(selectedAsset))}`, { cache: 'no-store' });
    setCampaigns(data.campaigns || []); setMessage(`Đã tải ${data.campaigns?.length || 0} campaign.`);
  }

  async function changeCampaign(campaignId: string, status: 'ACTIVE' | 'PAUSED' | 'DELETED') {
    if (!selectedAsset || selectedAsset.type !== 'TKQC') return;
    if (status === 'DELETED' && !window.confirm('Xóa campaign này?')) return;
    const data = await jsonFetch<{ message?: string }>('/api/campaign-ops', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenId: selectedAsset.sourceTokenId || selectedToken, accountId: metaId(selectedAsset), campaignId, status }),
    });
    setMessage(data.message || 'Đã cập nhật campaign.'); await loadCampaigns();
  }

  async function loadPageData() {
    if (!selectedAsset || selectedAsset.type !== 'Page') { setError('Chọn Page trước.'); return; }
    const data = await jsonFetch<{ page?: Record<string, unknown>; posts?: PagePost[] }>(`/api/page-ops?tokenId=${encodeURIComponent(selectedAsset.sourceTokenId || selectedToken)}&pageId=${encodeURIComponent(metaId(selectedAsset))}`, { cache: 'no-store' });
    setPageSummary(data.page || null); setPagePosts(data.posts || []); setMessage(`Đã đọc ${data.posts?.length || 0} bài viết.`);
  }

  async function publishPagePost() {
    if (!selectedAsset || selectedAsset.type !== 'Page') { setError('Chọn Page trước.'); return; }
    const messageText = postMessage.trim() || window.prompt('Nội dung đăng Page:', '')?.trim() || '';
    if (!messageText) { setError('Nhập nội dung bài viết.'); return; }
    const data = await jsonFetch<{ message?: string }>('/api/page-ops', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'publish', tokenId: selectedAsset.sourceTokenId || selectedToken, pageId: metaId(selectedAsset), message: messageText }),
    });
    setPostMessage(''); await loadPageData(); setMessage(data.message || 'Đã đăng bài lên Page.');
  }

  async function deletePagePost(postId: string) {
    if (!selectedAsset || selectedAsset.type !== 'Page' || !window.confirm('Xóa bài viết này?')) return;
    const data = await jsonFetch<{ message?: string }>('/api/page-ops', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_post', tokenId: selectedAsset.sourceTokenId || selectedToken, pageId: metaId(selectedAsset), postId }),
    });
    await loadPageData(); setMessage(data.message || 'Đã xóa bài viết.');
  }

  function backupBm() {
    if (!selectedAsset || selectedAsset.type !== 'BM') { setError('Chọn BM trước.'); return; }
    const children = assets.filter((asset) => asset.parent === selectedAsset.id);
    const blob = new Blob([JSON.stringify({ business: selectedAsset, assets: children, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `bm-${metaId(selectedAsset)}-backup.json`; a.click(); URL.revokeObjectURL(url);
    setMessage('Đã xuất file backup JSON.');
  }

  function alerts() {
    return <>
      {progress && <div className={styles.progress}><LoaderCircle className={styles.spin} size={14}/>{progress}</div>}
      {error && <div className={styles.error}>{error}<button onClick={()=>setError('')}><X size={14}/></button></div>}
      {message && <div className={styles.success}><CheckCircle2 size={14}/>{message}<button onClick={()=>setMessage('')}><X size={14}/></button></div>}
    </>;
  }

  function renderToolPanel() {
    const bulkIds = selectedIds.length ? selectedIds : filteredAssets.slice(0, 100).map((asset) => asset.id);
    return <aside style={{ background:'#fff', border:'1px solid #e0e6ef', borderRadius:14, minHeight:520, maxHeight:'calc(100vh - 178px)', overflow:'auto', padding:14 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <div><strong>Bảng công cụ {RESOURCE_META[resourceTab].label}</strong><div style={{ fontSize:10, color:'#8b94a6' }}>{selectedAsset ? selectedAsset.name : `${bulkIds.length} tài nguyên đang lọc`}</div></div><Settings2 size={16}/>
      </div>
      <div style={{ display:'grid', gap:8 }}>
        {currentTools(resourceTab).map((tool) => (
          <button key={tool.id} className={styles.ghost} onClick={() => void runResourceAction(tool.kind, tool.title)} disabled={busy} style={{ justifyContent:'space-between', opacity: 1 }}>
            <span style={{ display:'flex', alignItems:'center', gap:8 }}><Sparkles size={13}/> {tool.title}</span><ChevronRight size={13}/>
          </button>
        ))}
      </div>
      {!selectedAsset && <div style={{ color:'#6b7488', fontSize:11, lineHeight:1.6, marginTop:12 }}>Các nút không bị khóa nữa. Chức năng hàng loạt chạy ngay nếu có danh sách; chức năng cần một tài nguyên sẽ nhắc bạn chọn dòng trong bảng.</div>}
      {selectedAsset?.type === 'TKQC' && billing && <div style={{ marginTop:12, fontSize:11, lineHeight:1.7, background:'#f8fafd', padding:10, borderRadius:10 }}>Currency: {billing.currency || '—'}<br/>Spent: {billing.amountSpent || '—'}<br/>Balance: {billing.balance || '—'}<br/>Spend cap: {billing.spendCap || '—'}<br/>Funding: {billing.hasFundingSource ? billing.fundingDisplay || billing.fundingType || 'Có' : 'Chưa có'}</div>}
      {selectedAsset?.type === 'TKQC' && campaigns.length > 0 && <div style={{ marginTop:12, display:'grid', gap:8 }}>{campaigns.map((camp) => <div key={camp.id} style={{ border:'1px solid #e4e9f2', borderRadius:10, padding:9 }}><strong style={{ fontSize:11 }}>{camp.name}</strong><div style={{ fontSize:10, color:'#8b94a6', margin:'4px 0' }}>{camp.effectiveStatus || camp.status} · {camp.objective || '—'}</div><div style={{ display:'flex', gap:6, flexWrap:'wrap' }}><button className={styles.ghost} onClick={() => void changeCampaign(camp.id,'ACTIVE')}>Bật</button><button className={styles.ghost} onClick={() => void changeCampaign(camp.id,'PAUSED')}>Dừng</button><button className={styles.ghost} onClick={() => void changeCampaign(camp.id,'DELETED')}><Trash2 size={12}/> Xóa</button></div></div>)}</div>}
      {selectedAsset?.type === 'Page' && <div style={{ marginTop:12, display:'grid', gap:8 }}><textarea value={postMessage} onChange={(e)=>setPostMessage(e.target.value)} placeholder="Nội dung đăng Page" style={{ minHeight:78, border:'1px solid #dfe5ef', borderRadius:10, padding:9 }}/>{pageSummary && <div style={{ fontSize:10, lineHeight:1.7, background:'#f8fafd', padding:10, borderRadius:10 }}>Followers: {String(pageSummary.followersCount || 0)} · Fans: {String(pageSummary.fanCount || 0)}<br/>Verification: {String(pageSummary.verificationStatus || '—')}</div>}{pagePosts.slice(0,10).map((post) => <div key={post.id} style={{ border:'1px solid #e4e9f2', borderRadius:10, padding:9, fontSize:10 }}><div>{post.message || '(không có text)'}</div><button className={styles.ghost} onClick={() => void deletePagePost(post.id)}><Trash2 size={12}/> Xóa bài</button></div>)}</div>}
    </aside>;
  }

  function renderManage() {
    const meta = RESOURCE_META[resourceTab]; const Icon = meta.icon;
    return <div className={styles.workspace}><aside className={styles.sidebar}><div className={styles.sideTitle}><ShieldCheck size={18}/><div><strong>QUẢN LÝ TÀI NGUYÊN</strong><small>BM · ADS · PAGE</small></div></div>{(Object.keys(RESOURCE_META) as ResourceTab[]).map((tab) => { const M = RESOURCE_META[tab]; const I = M.icon; return <button key={tab} className={resourceTab===tab?styles.sideActive:''} onClick={() => { setResourceTab(tab); setSelectedIds([]); setSelectedAssetId(''); setBilling(null); setCampaigns([]); setPagePosts([]); }}><span><I size={15}/></span><strong>{M.label}</strong><em>{stats[tab]}</em><ChevronRight size={13}/></button>; })}<div className={styles.sideNote}>Đã bỏ ổ khóa và trạng thái mờ. Nút API thật chạy thật; nút không có luồng token-only sẽ trả thông báo rõ.</div></aside><main className={styles.content}><div className={styles.pageHead}><div><div className={styles.kicker}>RESOURCE MANAGER</div><h2>{meta.label}</h2><p>Danh sách được đồng bộ trực tiếp từ token đã check. Group đã bỏ theo yêu cầu.</p></div><div className={styles.actions}><button className={styles.secondary} onClick={()=>void loadAll()}><RefreshCw size={14}/> Làm mới</button><button onClick={()=>selectedToken&&void syncToken(selectedToken).then(loadAssets)} disabled={!selectedToken||busy}><RefreshCw size={14}/> Đồng bộ token</button></div></div>{alerts()}<div className={styles.toolbar}><div className={styles.search}><Search size={14}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder={`Tìm ${meta.label}...`}/></div><select value={selectedToken} onChange={(e)=>setSelectedToken(e.target.value)}><option value="">Tất cả token</option>{tokens.map((token)=><option key={token.id} value={token.id}>{token.label} · {STATUS_TEXT[token.status]}</option>)}</select><button className={styles.ghost} onClick={()=>void health(selectedIds.length?selectedIds:filteredAssets.slice(0,100).map((a)=>a.id))} disabled={busy}>Check all</button><button className={styles.ghost} onClick={()=>void pushCrm(selectedIds.length?selectedIds:filteredAssets.slice(0,100).map((a)=>a.id))} disabled={busy}><Send size={13}/> CRM</button></div><div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) 380px', gap:12 }}><div className={styles.tableCard}><table><thead><tr><th></th><th>Tên</th><th>ID</th><th>Trạng thái</th><th>Chi tiết</th><th>Check gần nhất</th></tr></thead><tbody>{filteredAssets.map((asset)=><tr key={asset.id} onClick={()=>setSelectedAssetId(asset.id)} style={{ cursor:'pointer', background:selectedAssetId===asset.id?'#f4f7ff':undefined }}><td><input type="checkbox" checked={selectedIds.includes(asset.id)} onClick={(e)=>e.stopPropagation()} onChange={(e)=>setSelectedIds((prev)=>e.target.checked?[...prev,asset.id]:prev.filter((id)=>id!==asset.id))}/></td><td><strong>{asset.name}</strong><small>{tokens.find((t)=>t.id===asset.sourceTokenId)?.label || ''}</small></td><td>{metaId(asset)}</td><td><span className={statusClass(asset.status)}>{asset.status}</span></td><td>{asset.type==='BM'?(asset.verificationStatus||'—'):asset.type==='TKQC'?`${asset.currency||''} ${asset.limit||''}`:asset.healthNote||'—'}</td><td>{asset.checked?new Date(asset.checked).toLocaleString('vi-VN'):'—'}</td></tr>)}</tbody></table>{!filteredAssets.length&&<div className={styles.empty}><Icon size={22}/><strong>Chưa có {meta.label}</strong><span>Nạp/check token rồi đồng bộ tài nguyên.</span></div>}</div>{renderToolPanel()}</div></main></div>;
  }

  function renderTokenTab() {
    return <><div className={styles.pageHead}><div><div className={styles.kicker}>TOKEN CENTER</div><h2>Nạp token → check → đồng bộ tài nguyên</h2><p>Check tài nguyên bằng token Graph hoặc cookie session Facebook đã nạp. Không cần OAuth dialog Meta.</p></div><div className={styles.actions}><button className={styles.secondary} onClick={()=>void scanTokens(tokens.map((t)=>t.id))} disabled={busy||!tokens.length}><RefreshCw size={14}/> Check tất cả token</button></div></div>{alerts()}<div className={styles.tokenImport}><div><label>Token / danh sách token</label><textarea value={tokenText} onChange={(e)=>setTokenText(e.target.value)} placeholder="Dán token, tên|token, CSV, JSON hoặc access_token=..."/></div><label className={styles.fileBox}><input ref={fileInputRef} type="file" onChange={(e)=>void onTokenFile(e.target.files?.[0]||null)}/><FileUp size={28}/><strong>{fileName||'Chọn file token'}</strong><span>Mọi file text; UTF-8/UTF-16.</span></label><button onClick={()=>void importCheckAndSync()} disabled={busy}><BadgeCheck size={15}/>{busy?'Đang xử lý…':'Nạp + Check + Đồng bộ'}</button></div><div className={styles.tokenList}><div className={styles.sectionHead}><div><strong>Kho token</strong><span>{tokens.length} token · {liveTokens.length} LIVE</span></div></div>{tokens.map((token)=><div className={styles.tokenRow} key={token.id}><div className={styles.tokenName}><span className={token.status==='active'?styles.liveDot:styles.deadDot}/><div><strong>{token.metaUserName?`${token.metaUserName} - ${token.metaUserId||''}`:token.label}</strong><small>{token.lastError||token.inventory?.warnings?.[0]||'Chưa có lỗi.'}</small>{token.inventory && <details className={styles.scopeDetails}><summary>Quyền ({token.inventory.permissions.length})</summary><div>{token.inventory.permissions.length ? token.inventory.permissions.map((permission)=><span key={permission}>{permission}</span>) : 'Không đọc được quyền từ Graph'}</div></details>}</div></div><span className={statusClass(token.status)}>{STATUS_TEXT[token.status]}</span><div className={styles.resourceMini}><span>BM <b>{token.inventory?.businessCount||0}</b></span><span>ADS <b>{token.inventory?.adAccountCount||0}</b></span><span>Page <b>{token.inventory?.pageCount||0}</b></span></div><div style={{display:'flex',gap:6,justifyContent:'flex-end',flexWrap:'wrap'}}><button className={styles.ghost} onClick={()=>void scanTokens([token.id])} disabled={busy}><ShieldCheck size={13}/> Check</button><button className={styles.ghost} onClick={()=>void renameToken(token)} disabled={busy}>Sửa</button><button className={styles.ghost} onClick={()=>void deleteToken(token)} disabled={busy}><Trash2 size={13}/> Xóa</button></div></div>)}</div></>;
  }

  function renderBmCreate() {
    const current = tokens.find((t)=>t.id===selectedToken);
    return <><div className={styles.pageHead}><div><div className={styles.kicker}>RESOURCE CREATOR</div><h2>Tạo BM từ token</h2><p>Chọn token LIVE, đọc Page token quản lý rồi tạo BM.</p></div></div>{alerts()}<div className={styles.formCard}><label>Token<select value={selectedToken} onChange={(e)=>{setSelectedToken(e.target.value);setBmReady(false);setBmPages([]);}}><option value="">Chọn token</option>{liveTokens.map((t)=><option key={t.id} value={t.id}>{t.label}</option>)}</select></label><div className={styles.permissionStrip}><span className={current?.status==='active'?styles.statusLive:styles.statusWarn}>{current?STATUS_TEXT[current.status]:'Chưa chọn'}</span>{current?.inventory?.permissions.map((p)=><span key={p}>{p}</span>)}</div><button onClick={()=>void prepareBm()} disabled={busy||!selectedToken}><RefreshCw size={14}/> Đọc Page của token</button>{bmReady&&<div className={styles.formGrid}><label>Tên BM<input value={bmName} onChange={(e)=>setBmName(e.target.value)} placeholder="Tên Business"/></label><label>Page đại diện<select value={bmPage} onChange={(e)=>setBmPage(e.target.value)}>{bmPages.map((p)=><option key={p.id} value={p.id}>{p.name} · {p.id}</option>)}</select></label><label>Timezone ID<input value={bmTimezone} onChange={(e)=>setBmTimezone(e.target.value)}/></label><label>Vertical<select value={bmVertical} onChange={(e)=>setBmVertical(e.target.value)}><option>ADVERTISING</option><option>ECOMMERCE</option><option>MARKETING</option><option>TECHNOLOGY</option><option>OTHER</option></select></label></div>}{bmReady&&<button onClick={()=>void createBm()} disabled={busy||!bmName||!bmPage}><Plus size={14}/> Tạo BM</button>}</div></>;
  }

  function renderCrm() {
    return <><div className={styles.pageHead}><div><div className={styles.kicker}>CCRM / CRM</div><h2>Liên kết CRM</h2><p>Dùng lại gateway CRM cũ của app. BM, ADS và Page được đẩy qua /api/crm-push.</p></div><div className={styles.actions}><button className={styles.secondary} onClick={()=>void checkCrm()} disabled={busy}><RefreshCw size={14}/> Kiểm tra kết nối</button></div></div>{alerts()}<div className={styles.formCard}><div className={styles.permissionStrip}><span className={crmConfigured===true?styles.statusLive:styles.statusWarn}>{crmConfigured===null?'Chưa kiểm tra':crmConfigured?'CRM đã cấu hình':'Chưa có API key CRM'}</span></div><p style={{fontSize:11,color:'#6b7488'}}>Sau khi token được check/sync, bạn có thể đẩy BM/TKQC/Page từ bảng công cụ hoặc đẩy toàn bộ bên dưới.</p><button onClick={()=>void pushCrm(assets.filter((a)=>['BM','TKQC','Page'].includes(a.type)).slice(0,100).map((a)=>a.id))} disabled={busy||!assets.length}><Send size={14}/> Đẩy tối đa 100 tài nguyên hiện có</button></div></>;
  }

  function renderCreate() {
    return <div className={styles.workspace}><aside className={styles.sidebar}><div className={styles.sideTitle}><Plus size={18}/><div><strong>TẠO TÀI NGUYÊN</strong><small>Token · BM · CRM</small></div></div><button className={createTab==='token'?styles.sideActive:''} onClick={()=>setCreateTab('token')}><span><KeyRound size={15}/></span><strong>Nạp & check token</strong><ChevronRight size={13}/></button><button className={createTab==='bm'?styles.sideActive:''} onClick={()=>setCreateTab('bm')}><span><Building2 size={15}/></span><strong>Tạo BM từ token</strong><ChevronRight size={13}/></button><button className={createTab==='crm'?styles.sideActive:''} onClick={()=>setCreateTab('crm')}><span><Send size={15}/></span><strong>Liên kết CRM</strong><ChevronRight size={13}/></button><div className={styles.sideNote}>Luồng chính: nạp token → check → tài nguyên tự về BM/ADS/PAGE → chạy công cụ bên Quản lý tài nguyên.</div></aside><main className={styles.content}>{createTab==='token'?renderTokenTab():createTab==='bm'?renderBmCreate():renderCrm()}</main></div>;
  }

  if (mode === 'home') return <div className={styles.shell}><TopBar mode={mode} live={liveTokens.length} total={tokens.length} onMode={(next)=>void openMode(next)}/><main className={styles.home}><section className={styles.hero}><div className={styles.kicker}>ADS WORKSPACE</div><h1>Token → tài nguyên → bảng công cụ</h1><p>Không còn ổ khóa/mờ nút. Các chức năng có API hợp lệ sẽ chạy bằng token nguồn; chức năng không có luồng token-only sẽ trả thông báo rõ.</p><div className={styles.heroActions}><button onClick={()=>void openMode('create')}><Plus size={15}/> Nạp token</button><button className={styles.secondary} onClick={()=>void openMode('manage')}><ShieldCheck size={15}/> Quản lý tài nguyên</button></div></section><div className={styles.flowGrid}><article><KeyRound size={18}/><strong>1. Check token</strong><span>Token phải được Meta Graph API chấp nhận thì backend mới đồng bộ được tài nguyên.</span></article><article><Building2 size={18}/><strong>2. BM/ADS/PAGE</strong><span>Tài nguyên được gắn token nguồn để thao tác đúng quyền.</span></article><article><Sparkles size={18}/><strong>3. Công cụ mẫu</strong><span>Bảng công cụ theo từng mục ADS/BM/PAGE giống mẫu và không bị khóa giao diện.</span></article></div></main></div>;
  return <div className={styles.shell}><TopBar mode={mode} live={liveTokens.length} total={tokens.length} onMode={(next)=>void openMode(next)}/>{mode==='manage'?renderManage():renderCreate()}</div>;
}

function TopBar({ mode, live, total, onMode }: { mode: Mode; live: number; total: number; onMode: (mode: Mode)=>void }) {
  return <header className={styles.topbar}><div className={styles.brand}><Zap size={17}/><strong>ADS WORKSPACE</strong></div><nav className={styles.topnav}><button className={mode==='home'?styles.topActive:''} onClick={()=>onMode('home')}><Home size={14}/> HOME</button><button className={mode==='manage'?styles.topActive:''} onClick={()=>onMode('manage')}><ShieldCheck size={14}/> QUẢN LÝ TÀI NGUYÊN</button><button className={mode==='create'?styles.topActive:''} onClick={()=>onMode('create')}><Plus size={14}/> TẠO TÀI NGUYÊN</button></nav><div className={styles.topStatus}><span className={live?styles.liveDot:styles.deadDot}/>{live}/{total} token LIVE</div></header>;
}
