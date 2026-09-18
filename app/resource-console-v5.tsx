'use client';

import { useMemo, useRef, useState } from 'react';
import {
  BadgeCheck,
  Building2,
  CheckCircle2,
  ChevronLeft,
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
import {
  adAccessLabel,
  adDeliveryLabel,
  adReadSourceLabel,
  readSourceFromSources,
  resolveAdDelivery,
  resolveAdAccess,
  summarizeAdAssets,
} from '../lib/ad-status';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from '../components/ui/pagination';
import styles from './unified-meta-workspace.module.css';

type Mode = 'home' | 'manage' | 'create';
type ResourceTab = 'BM' | 'TKQC' | 'Page' | 'Dataset/Pixel';
type CreateTab = 'token' | 'bm' | 'crm' | 'shop';
type TokenStatus = 'active' | 'invalid' | 'permission_issue' | 'rate_limited' | 'create_restricted' | 'unknown_error';
type RunKind =
  | 'health'
  | 'sync'
  | 'crm'
  | 'accessLink'
  | 'shop'
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
  confirmedPermissions?: string[];
  inferredPermissions?: string[];
  // null = lần scan đó KHÔNG đọc được (khác hẳn 0 thật); bucket ADS luôn đầy đủ
  // để total = tổng các bucket (xem app/api/token-runtime/route.ts).
  businessCount: number | null;
  verifiedBusinessCount: number | null;
  pageCount: number | null;
  adAccountCount: number | null;
  liveAdCount: number;
  dieAdCount: number;
  restrictedAdCount: number;
  pendingAdCount?: number;
  unsettledAdCount?: number;
  closedAdCount?: number;
  unknownAdCount?: number;
  pixelCount?: number | null;
  totalResources: number | null;
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
  'Dataset/Pixel': { label: 'PIXEL / DATASET', icon: Sparkles },
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
  { id: 'access-link', title: 'Sinh Link BM', kind: 'accessLink' },
  { id: 'shop', title: 'Đẩy Shop Online', kind: 'shop' },
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

const PIXEL_TOOLS: ActionItem[] = [
  { id: 'check', title: 'Check Pixel / Dataset', kind: 'refresh' },
  { id: 'open', title: 'Mở Business Settings', kind: 'open' },
  { id: 'crm', title: 'Đẩy CRM', kind: 'crm' },
];

function metaId(asset: Asset) {
  return asset.metaId || asset.id.match(/meta:(\d{5,30})$/)?.[1] || asset.id.match(/(\d{5,30})$/)?.[1] || '';
}

function bmField(value: string | number | null | undefined, unknownValues: string[] = []) {
  const normalized = String(value ?? '').trim();
  return normalized && !unknownValues.includes(normalized.toLowerCase()) ? normalized : 'Chưa đọc được';
}

function bmCurrency(asset: Asset) {
  if (asset.currencyMode === 'MULTI' && asset.currencies?.length) return 'MULTI';
  if (asset.currency && asset.currency !== 'NONE' && asset.currency !== 'UNKNOWN') return asset.currency;
  if (asset.adAccountCount === 0 && asset.bmDetailsStatus !== 'unavailable') return 'Không có TKQC';
  return 'Chưa đọc được';
}

function bmResourceCount(exact: number | null | undefined, observed: number | undefined) {
  if (exact !== undefined && exact !== null) return String(exact);
  if (observed) return `Đã thấy ${observed}+`;
  return 'Chưa đọc được';
}

function bmReadStatus(asset: Asset) {
  if (asset.bmDetailsStatus === 'complete') return 'Đã đọc hồ sơ và tài nguyên liên kết';
  if (asset.bmDetailsStatus === 'partial') return 'Đã đọc một phần từ Meta/session';
  return 'Chưa đọc được hồ sơ chi tiết';
}

function bmTypeLabel(asset: Asset) {
  return asset.bmType && asset.bmType !== 'UNKNOWN' ? asset.bmType : 'Chưa xác định owned/client';
}

function paginationItems(current: number, total: number): Array<number | 'start-ellipsis' | 'end-ellipsis'> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const items: Array<number | 'start-ellipsis' | 'end-ellipsis'> = [1];
  if (current > 3) items.push('start-ellipsis');
  for (let page = Math.max(2, current - 1); page <= Math.min(total - 1, current + 1); page += 1) items.push(page);
  if (current < total - 2) items.push('end-ellipsis');
  items.push(total);
  return items;
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

function invText(value: number | null | undefined) {
  // null/undefined = chưa đọc được (hiển thị '—'), KHÔNG fake 0.
  return value === null || value === undefined ? '—' : String(value);
}

function adAccessBadgeClass(access: Asset['accessStatus']) {
  if (access === 'ACCESSIBLE') return styles.statusLive;
  if (access === 'ACCESS_LOST') return styles.statusDie;
  return styles.statusUnknown;
}

function adDeliveryBadgeClass(bucket: string) {
  if (bucket === 'live') return styles.statusLive;
  if (bucket === 'die' || bucket === 'closed' || bucket === 'unsettled') return styles.statusDie;
  return styles.statusWarn;
}

/** Ô trạng thái TKQC: tách access (quyền truy cập) và delivery (trạng thái QC). */
function adStatusCell(asset: Asset) {
  const resolved = resolveAdDelivery(asset);
  const access = resolveAdAccess(asset);
  const source = asset.readSource ?? readSourceFromSources(asset.assetSources);
  const raw = resolved.rawAccountStatus ?? asset.rawAccountStatus;
  return <div className={styles.statusStack}>
    <span className={adAccessBadgeClass(access)}>{access === 'ACCESSIBLE' ? '🟢' : access === 'ACCESS_LOST' ? '🔴' : '⚪'} {adAccessLabel(access)}</span>
    <span className={adDeliveryBadgeClass(resolved.bucket)}>{adDeliveryLabel(resolved.deliveryStatus)}{raw !== undefined ? ` · Meta ${raw}` : ''}</span>
    <small>Nguồn: {adReadSourceLabel(source)}</small>
  </div>;
}

function currentTools(tab: ResourceTab) {
  if (tab === 'BM') return BM_TOOLS;
  if (tab === 'TKQC') return ADS_TOOLS;
  if (tab === 'Page') return PAGE_TOOLS;
  return PIXEL_TOOLS;
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
  const [resourcePage, setResourcePage] = useState(1);
  const [resourcePageSize, setResourcePageSize] = useState(8);
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
  const [bmMode, setBmMode] = useState<'manual'|'semi_auto'|'auto'>('manual');
  const [bmCount, setBmCount] = useState(1);
  const [bmUntilLimit, setBmUntilLimit] = useState(false);
  const [bmNamePattern, setBmNamePattern] = useState('{name} {n}');
  const [bmDelayMs, setBmDelayMs] = useState(1000);
  const [bmContinueOnError, setBmContinueOnError] = useState(false);
  const [bmMaxErrors, setBmMaxErrors] = useState(3);
  const [bmAutoSync, setBmAutoSync] = useState(true);
  const [bmAutoCheck, setBmAutoCheck] = useState(true);
  const [bmAutoLink, setBmAutoLink] = useState(false);
  const [bmAutoShop, setBmAutoShop] = useState(false);
  const [linkFilter, setLinkFilter] = useState('ALL');
  const [shopFilter, setShopFilter] = useState('ALL');
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
      if (asset.type === 'BM' && linkFilter !== 'ALL' && (asset.accessLinkStatus || 'none') !== linkFilter) return false;
      if (asset.type === 'BM' && shopFilter !== 'ALL' && (asset.shopStatus || 'not_ready') !== shopFilter) return false;
      if (!needle) return true;
      return `${asset.name} ${metaId(asset)} ${asset.status} ${asset.verificationStatus || ''}`.toLowerCase().includes(needle);
    });
  }, [assets, query, resourceTab, selectedToken, linkFilter, shopFilter]);
  const resourcePageCount = Math.max(1, Math.ceil(filteredAssets.length / resourcePageSize));
  const safeResourcePage = Math.min(resourcePage, resourcePageCount);
  const pagedAssets = useMemo(() => {
    const start = (safeResourcePage - 1) * resourcePageSize;
    return filteredAssets.slice(start, start + resourcePageSize);
  }, [filteredAssets, resourcePageSize, safeResourcePage]);
  const visibleResourcePages = useMemo(
    () => paginationItems(safeResourcePage, resourcePageCount),
    [safeResourcePage, resourcePageCount],
  );
  // Reset về trang 1 ngay tại các handler lọc (setResourcePage trong useEffect
  // bị cấm bởi react-hooks/set-state-in-effect).
  const stats = useMemo(() => ({
    BM: assets.filter((asset) => asset.type === 'BM').length,
    TKQC: assets.filter((asset) => asset.type === 'TKQC').length,
    Page: assets.filter((asset) => asset.type === 'Page').length,
    'Dataset/Pixel': assets.filter((asset) => asset.type === 'Dataset/Pixel').length,
  }), [assets]);
  // Thống kê kho TKQC: total luôn bằng tổng các bucket (không bỏ sót UNKNOWN).
  const tkqcStats = useMemo(
    () => summarizeAdAssets(assets.filter((asset) => asset.type === 'TKQC')),
    [assets],
  );

  async function jsonFetch<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    const data = await response.json() as T & { error?: string; message?: string; errors?: unknown; failures?: unknown };
    if (!response.ok) {
      const error = new Error(data.error || data.message || `HTTP ${response.status}`) as Error & { status?: number; details?: unknown };
      error.status = response.status;
      error.details = data;
      throw error;
    }
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
        const data = await jsonFetch<{ accepted?: unknown[]; status?: string; message?: string }>('/api/crm-push', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metaIds: metaIds.slice(i, i + 100) }),
        });
        accepted += data.accepted?.length || 0;
        // Backend tự nói đúng trạng thái: LOCAL_ONLY => "đã lưu local", PUSHED => "đã đẩy".
        await loadAssets();
        setMessage(data.message || `Đã xử lý ${accepted} tài nguyên qua CRM.`);
      }
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function generateAccessLinks(ids: string[]) {
    const bmIds = ids.filter((id) => assets.find((asset) => asset.id === id)?.type === 'BM');
    if (!bmIds.length) { setError('Chọn ít nhất một BM để sinh link.'); return; }
    setBusy(true); setError('');
    try {
      const data = await jsonFetch<{ summary: { total:number; success:number; failed:number }; failures?: Array<{name:string;error:string}> }>('/api/bm-access-link', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ assetIds: bmIds, continueOnError:true, maxConsecutiveErrors:5 }),
      });
      await loadAssets();
      setMessage(`Sinh Link BM — Tổng: ${data.summary.total}, thành công: ${data.summary.success}, thất bại: ${data.summary.failed}.`);
      if (data.failures?.length) setError(data.failures.map((item)=>`${item.name}: ${item.error}`).join('\n'));
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function pushShop(ids: string[]) {
    const bmIds = ids.filter((id) => assets.find((asset) => asset.id === id)?.type === 'BM');
    if (!bmIds.length) { setError('Chỉ BM được phép đẩy Shop.'); return; }
    setBusy(true); setError('');
    try {
      const data = await jsonFetch<{ summary: { total:number; success:number; failed:number }; failures?: Array<{name:string;error:string}> }>('/api/shop-online', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ assetIds: bmIds, continueOnError:true, maxConsecutiveErrors:5 }),
      });
      await loadAssets();
      setMessage(`Shop Online — Tổng: ${data.summary.total}, thành công: ${data.summary.success}, thất bại: ${data.summary.failed}.`);
      if (data.failures?.length) setError(data.failures.map((item)=>`${item.name}: ${item.error}`).join('\n'));
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function checkCrm() {
    setBusy(true); setError(''); setMessage('');
    try {
      const data = await jsonFetch<{ configured?: boolean; mode?: string; endpoint?: string }>('/api/crm-push', { cache: 'no-store' });
      setCrmConfigured(Boolean(data.configured));
      setMessage(data.configured ? `CRM đã kết nối gateway (${data.endpoint}).` : 'CRM local: chưa cấu hình BVAGC_RESOURCE_GATEWAY_URL, đẩy sẽ chỉ lưu trong workspace.');
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
    const bulkIds = selectedIds.length ? selectedIds : pagedAssets.map((asset) => asset.id);
    if (kind === 'health') return health(bulkIds);
    if (kind === 'sync') return selectedToken ? syncToken(selectedToken).then(loadAssets) : setError('Chọn token trước.');
    if (kind === 'crm') return pushCrm(selectedAsset ? [selectedAsset.id] : bulkIds);
    if (kind === 'accessLink') return generateAccessLinks(selectedAsset ? [selectedAsset.id] : bulkIds);
    if (kind === 'shop') return pushShop(selectedAsset ? [selectedAsset.id] : bulkIds);
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
      const data = await jsonFetch<{ pages?: PageItem[]; warnings?: string[] }>('/api/business-manager?tokenId=' + encodeURIComponent(selectedToken), { cache: 'no-store' });
      const pages = data.pages || [];
      setBmPages(pages); setBmPage(pages[0]?.id || ''); setBmReady(true);
      if (!pages.length) setMessage('Không có Page. Có thể tạo BM trắng (không primary_page).');
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function createBm() {
    if (!bmName.trim()) { setError('Nhập tên BM.'); return; }
    setBusy(true); setError('');
    try {
      const data = await jsonFetch<{ message?: string; limitReached?: boolean; summary?: {total:number;success:number;failed:number}; failures?: Array<{name:string;errors:Array<{stage:string;source:string;message:string}>}> }>('/api/business-manager', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId: selectedToken, mode: bmMode, name: bmName, namePattern: bmNamePattern,
          count: bmMode === 'manual' ? 1 : bmCount, stopOnLimit: bmUntilLimit,
          primaryPage: bmPage || '', timezone: Number(bmTimezone) || 140,
          vertical: bmVertical, adminEmail: '', delayMs: bmDelayMs, continueOnError: bmContinueOnError || bmUntilLimit,
          maxConsecutiveErrors: bmMaxErrors, autoCheckProfile: bmAutoCheck, autoSync: bmAutoSync,
          autoGenerateAccessLink: bmAutoLink, autoPushShop: bmAutoShop, purposeConfirmed: true,
        }),
      });
      setMessage(`${data.limitReached ? '⛔ ' : ''}${data.message || 'Đã tạo BM.'}${data.limitReached && data.summary ? ` Tổng kết: ${data.summary.success} BM thành công trước khi chạm giới hạn.` : ''}`);
      setBmName('');
      if (data.failures?.length) setError(data.failures.flatMap((item)=>item.errors.map((failure)=>`${item.name} · ${failure.stage}/${failure.source}: ${failure.message}`)).join('\n'));
      await loadAll();
    } catch (err) {
      const detailed = err as Error & {details?: {errors?: Array<{stage:string;source:string;message:string}>;failures?: Array<{name:string;errors:Array<{stage:string;source:string;message:string}>}>; limitReached?: boolean}};
      const rows = detailed.details?.errors || detailed.details?.failures?.flatMap((item)=>item.errors.map((failure)=>({...failure,message:`${item.name}: ${failure.message}`}))) || [];
      setError((detailed.details?.limitReached ? '⛔ Chạm giới hạn tạo BM của Meta. ' : '') + (rows.length ? rows.map((item)=>`${item.stage}/${item.source}: ${item.message}`).join('\n') : detailed.message));
    }
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
    const bulkIds = selectedIds.length ? selectedIds : pagedAssets.map((asset) => asset.id);
    return <aside className={styles.toolPanel}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <div><strong>Bảng công cụ {RESOURCE_META[resourceTab].label}</strong><div style={{ fontSize:10, color:'#8b94a6' }}>{selectedAsset ? selectedAsset.name : `${bulkIds.length} tài nguyên trên trang này`}</div></div><Settings2 size={16}/>
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

  function resourceDetails(asset: Asset) {
    const business = asset.businessName || assets.find((item) => item.id === asset.parent)?.name || '—';
    if (asset.type === 'TKQC') {
      const resolved = resolveAdDelivery(asset);
      return <div className={styles.metaGrid}>
        <span>Trạng thái QC: <b>{adDeliveryLabel(resolved.deliveryStatus)}</b></span>
        <span>Tiền tệ: <b>{asset.currency || '—'}</b></span>
        <span>Đã chi: <b>{asset.amountSpent || '—'}</b></span>
        <span>Số dư: <b>{asset.balance || '—'}</b></span>
        <span>Limit: <b>{asset.spendCap || asset.limit || '—'}</b></span>
        <span>Thanh toán: <b>{asset.billingType === 'PREPAID' ? 'Trả trước' : asset.billingType === 'POSTPAID' ? 'Trả sau' : 'Chưa rõ'}</b></span>
        <span>Funding: <b>{asset.hasFundingSource ? asset.fundingDisplay || asset.fundingType || 'Có' : asset.hasFundingSource === false ? 'Chưa có' : 'Chưa đọc'}</b></span>
        <span>Timezone: <b>{asset.timezoneName || asset.timezoneId || '—'}</b></span>
        <span>BM: <b>{business}</b></span>
        <span>Quan hệ: <b>{asset.ownership === 'owned' ? 'BM sở hữu' : asset.ownership === 'client' ? 'Đối tác/client' : 'Chưa xác định'}</b></span>
        <span>Owner ID: <b>{asset.ownerId || '—'}</b></span>
        <span>Quốc gia: <b>{bmField(asset.country, ['unknown', 'chưa rõ'])}</b></span>
      </div>;
    }
    if (asset.type === 'Page') {
      return <div className={styles.metaGrid}>
        <span>Danh mục: <b>{asset.category || '—'}</b></span>
        <span>Followers: <b>{asset.followersCount ?? '—'}</b></span>
        <span>Fans: <b>{asset.fanCount ?? '—'}</b></span>
        <span>Verify: <b>{asset.verificationStatus || '—'}</b></span>
        <span>BM: <b>{business}</b></span>
      </div>;
    }
    return <div className={styles.metaGrid}>
      <span>BM: <b>{business}</b></span>
      <span>Tạo: <b>{asset.creationTime || '—'}</b></span>
      <span>Bắn gần nhất: <b>{asset.lastFiredTime || '—'}</b></span>
    </div>;
  }

  function renderManage() {
    const meta = RESOURCE_META[resourceTab]; const Icon = meta.icon;
    return <div className={styles.workspace}><aside className={styles.sidebar}><div className={styles.sideTitle}><ShieldCheck size={18}/><div><strong>QUẢN LÝ TÀI NGUYÊN</strong><small>BM · ADS · PAGE · PIXEL</small></div></div>{(Object.keys(RESOURCE_META) as ResourceTab[]).map((tab) => { const M = RESOURCE_META[tab]; const I = M.icon; return <button key={tab} className={resourceTab===tab?styles.sideActive:''} onClick={() => { setResourceTab(tab); setSelectedIds([]); setSelectedAssetId(''); setBilling(null); setCampaigns([]); setPagePosts([]); setResourcePage(1); }}><span><I size={15}/></span><strong>{M.label}</strong><em>{stats[tab]}</em><ChevronRight size={13}/></button>; })}<div className={styles.sideNote}>BM dùng snapshot chung với Token Center. Access link và Shop là hai trạng thái độc lập.</div></aside><main className={styles.content}><div className={styles.pageHead}><div><div className={styles.kicker}>RESOURCE MANAGER</div><h2>{meta.label}</h2><p>Số lượng tài nguyên lấy từ cùng Account Snapshot đã check. Các số tiền hiển thị theo đơn vị thô Meta API.</p></div><div className={styles.actions}><button className={styles.secondary} onClick={()=>void loadAll()}><RefreshCw size={14}/> Làm mới</button><button onClick={()=>selectedToken&&void syncToken(selectedToken).then(loadAssets)} disabled={!selectedToken||busy}><RefreshCw size={14}/> Đồng bộ token</button></div></div>{alerts()}{resourceTab==='TKQC'&&tkqcStats.total>0&&<div className={styles.adsStats}><span className={styles.adsStatsTotal}><b>{tkqcStats.total}</b> TKQC</span><span className={styles.pillLive}>LIVE {tkqcStats.live}</span><span className={styles.pillDie}>DIE {tkqcStats.die}</span><span className={styles.pillWarn}>HẠN CHẾ {tkqcStats.restricted}</span><span className={styles.pillWarn}>PENDING {tkqcStats.pending}</span><span className={styles.pillWarn}>CHƯA TT {tkqcStats.unsettled}</span><span className={styles.pillWarn}>ĐÃ ĐÓNG {tkqcStats.closed}</span><span className={styles.pillUnknown}>CHƯA XÁC ĐỊNH {tkqcStats.unknown}</span></div>}<div className={styles.toolbar}><div className={styles.search}><Search size={14}/><input value={query} onChange={(e)=>{setQuery(e.target.value);setResourcePage(1);}} placeholder={`Tìm ${meta.label}...`}/></div><select value={selectedToken} onChange={(e)=>{setSelectedToken(e.target.value);setResourcePage(1);}}><option value="">Tất cả token</option>{tokens.map((token)=><option key={token.id} value={token.id}>{token.label} · {STATUS_TEXT[token.status]}</option>)}</select>{resourceTab==='BM'&&<><select value={linkFilter} onChange={(e)=>{setLinkFilter(e.target.value);setResourcePage(1);}}><option value="ALL">Tất cả link</option><option value="none">Chưa sinh link</option><option value="ready">Link ready</option><option value="failed">Link failed</option></select><select value={shopFilter} onChange={(e)=>{setShopFilter(e.target.value);setResourcePage(1);}}><option value="ALL">Tất cả Shop</option><option value="not_ready">Chưa đẩy Shop</option><option value="pushed">Đã đẩy Shop</option><option value="failed">Shop failed</option></select><button className={styles.ghost} onClick={()=>void generateAccessLinks(selectedIds.length?selectedIds:filteredAssets.map((a)=>a.id))} disabled={busy}>Sinh Link BM</button><button className={styles.ghost} onClick={()=>void pushShop(selectedIds.length?selectedIds:filteredAssets.map((a)=>a.id))} disabled={busy}><Send size={13}/> Shop</button></>}<button className={styles.ghost} onClick={()=>void health(selectedIds.length?selectedIds:pagedAssets.map((a)=>a.id))} disabled={busy}>Check all</button></div><div className={styles.manageGrid}><div className={styles.tableCard} style={{overflowX:'auto'}}><table><thead><tr>{resourceTab==='BM'?<><th></th><th>Tên BM</th><th>Business ID</th><th>Loại BM</th><th>TKQC owned</th><th>TKQC đã có</th><th>Page</th><th>Tiền tệ</th><th>Verify</th><th>IP / Quốc gia tạo</th><th>Link truy cập</th><th>Shop status</th><th>Check gần nhất</th></>:<><th></th><th>Tên</th><th>ID</th><th>Trạng thái</th><th>Thông tin Meta</th><th>Check gần nhất</th></>}</tr></thead><tbody>{pagedAssets.map((asset)=><tr key={asset.id} onClick={()=>setSelectedAssetId(asset.id)} style={{ cursor:'pointer', background:selectedAssetId===asset.id?'#f4f7ff':undefined }}><td><input type="checkbox" checked={selectedIds.includes(asset.id)} onClick={(e)=>e.stopPropagation()} onChange={(e)=>setSelectedIds((prev)=>e.target.checked?[...prev,asset.id]:prev.filter((id)=>id!==asset.id))}/></td>{resourceTab==='BM'?<><td><strong>{asset.name}</strong><small>{tokens.find((t)=>t.id===asset.sourceTokenId)?.label || ''}</small><small>{[asset.vertical, asset.timezoneId && `TZ ${asset.timezoneId}`].filter(Boolean).join(' · ')}</small><small>{bmReadStatus(asset)}</small></td><td>{metaId(asset)}</td><td>{bmTypeLabel(asset)}</td><td>{bmResourceCount(asset.ownedAdAccountCount, asset.observedOwnedAdAccountCount)}</td><td>{bmResourceCount(asset.adAccountCount, asset.observedAdAccountCount)}</td><td>{bmResourceCount(asset.pageCount, asset.observedPageCount)}</td><td>{bmCurrency(asset)}{asset.currencies?.length?<small>{asset.currencies.join(', ')}</small>:null}</td><td><span className={statusClass(asset.status)}>{bmField(asset.verificationStatus, ['unknown'])}</span></td><td>{bmField(asset.country, ['unknown', 'chưa rõ'])}</td><td>{asset.accessLinkStatus==='ready'&&asset.accessLink?<div style={{display:'flex',gap:4}}><button className={styles.ghost} onClick={(e)=>{e.stopPropagation();window.open(asset.accessLink,'_blank','noopener,noreferrer')}} style={{color:'#14853d'}}>🟢 Mở Link</button><button className={styles.ghost} onClick={(e)=>{e.stopPropagation();void navigator.clipboard.writeText(asset.accessLink||'')}}>Copy</button></div>:asset.accessLinkStatus==='failed'?<button className={styles.ghost} title={asset.accessLinkError||''} style={{color:'#b42318'}}>🔴 Sinh lỗi</button>:<span>⚪ Chưa sinh</span>}</td><td title={asset.shopError||''}>{asset.shopStatus||'not_ready'}</td><td>{asset.statusCheckedAt||asset.checked?new Date(asset.statusCheckedAt||asset.checked||'').toLocaleString('vi-VN'):'—'}</td></>:<><td><strong>{asset.name}</strong><small>{tokens.find((t)=>t.id===asset.sourceTokenId)?.label || ''}</small></td><td>{metaId(asset)}</td><td>{adStatusCell(asset)}</td><td>{resourceDetails(asset)}</td><td>{asset.statusCheckedAt||asset.checked?new Date(asset.statusCheckedAt||asset.checked||'').toLocaleString('vi-VN'):'—'}</td></>}</tr>)}</tbody></table>{filteredAssets.length?<div className={styles.tableFooter}><span style={{fontSize:11,color:'#6b7488'}}>Hiển thị {(safeResourcePage-1)*resourcePageSize+1}–{Math.min(safeResourcePage*resourcePageSize,filteredAssets.length)} / {filteredAssets.length}</span><div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}><label style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'#6b7488'}}>Mỗi trang <select value={resourcePageSize} onChange={(e)=>{setResourcePageSize(Number(e.target.value));setResourcePage(1);}} style={{height:32,border:'1px solid #dfe5ef',borderRadius:8,padding:'0 8px',background:'#fff'}}><option value={8}>8</option><option value={15}>15</option><option value={30}>30</option></select></label><Pagination style={{width:'auto',margin:0}}><PaginationContent><PaginationItem><PaginationLink href="#" size="default" aria-label="Trang trước" aria-disabled={safeResourcePage===1} style={{pointerEvents:safeResourcePage===1?'none':undefined,opacity:safeResourcePage===1?.45:1,gap:4}} onClick={(e)=>{e.preventDefault();setResourcePage(Math.max(1,safeResourcePage-1));}}><ChevronLeft size={14}/> Trước</PaginationLink></PaginationItem>{visibleResourcePages.map((item)=>typeof item==='number'?<PaginationItem key={item}><PaginationLink href="#" isActive={item===safeResourcePage} aria-label={`Trang ${item}`} onClick={(e)=>{e.preventDefault();setResourcePage(item);}}>{item}</PaginationLink></PaginationItem>:<PaginationItem key={item}><PaginationEllipsis/></PaginationItem>)}<PaginationItem><PaginationLink href="#" size="default" aria-label="Trang sau" aria-disabled={safeResourcePage===resourcePageCount} style={{pointerEvents:safeResourcePage===resourcePageCount?'none':undefined,opacity:safeResourcePage===resourcePageCount?.45:1,gap:4}} onClick={(e)=>{e.preventDefault();setResourcePage(Math.min(resourcePageCount,safeResourcePage+1));}}>Sau <ChevronRight size={14}/></PaginationLink></PaginationItem></PaginationContent></Pagination></div></div>:null}{!filteredAssets.length&&<div className={styles.empty}><Icon size={22}/><strong>Chưa có {meta.label}</strong><span>Nạp/check token rồi đồng bộ tài nguyên.</span></div>}</div>{renderToolPanel()}</div></main></div>;
  }

  function renderTokenTab() {
    return <><div className={styles.pageHead}><div><div className={styles.kicker}>TOKEN CENTER</div><h2>Nạp token → check → đồng bộ tài nguyên</h2><p>BM, ADS và Page dùng chung một Account Snapshot; Page được merge từ Graph, Session, BM owned và BM client.</p></div><div className={styles.actions}><button className={styles.secondary} onClick={()=>void scanTokens(tokens.map((t)=>t.id))} disabled={busy||!tokens.length}><RefreshCw size={14}/> Check tất cả token</button></div></div>{alerts()}<div className={styles.tokenImport}><div><label>Token / danh sách token</label><textarea value={tokenText} onChange={(e)=>setTokenText(e.target.value)} placeholder="Dán token, tên|token, CSV, JSON hoặc access_token=..."/></div><label className={styles.fileBox}><input ref={fileInputRef} type="file" onChange={(e)=>void onTokenFile(e.target.files?.[0]||null)}/><FileUp size={28}/><strong>{fileName||'Chọn file token'}</strong><span>Mọi file text; UTF-8/UTF-16.</span></label><button onClick={()=>void importCheckAndSync()} disabled={busy}><BadgeCheck size={15}/>{busy?'Đang xử lý…':'Nạp + Check + Đồng bộ'}</button></div><div className={styles.tokenList}><div className={styles.sectionHead}><div><strong>Kho token</strong><span>{tokens.length} token · {liveTokens.length} LIVE</span></div></div>{tokens.map((token)=>{const confirmed=token.inventory?.confirmedPermissions||token.inventory?.permissions||[];const inferred=token.inventory?.inferredPermissions||[];return <div className={styles.tokenRow} key={token.id}><div className={styles.tokenName}><span className={token.status==='active'?styles.liveDot:styles.deadDot}/><div><strong>{token.metaUserName?`${token.metaUserName} - ${token.metaUserId||''}`:token.label}</strong><small>{token.lastError||token.inventory?.warnings?.[0]||'Chưa có lỗi.'}</small>{token.inventory&&<details className={styles.scopeDetails}><summary>Graph xác nhận {confirmed.length} · Session suy ra {inferred.length}</summary><div>{confirmed.map((permission)=><span key={`c-${permission}`}>✓ Graph: {permission}</span>)}{inferred.map((permission)=><span key={`i-${permission}`}>~ Session: {permission}</span>)}{!confirmed.length&&!inferred.length?'Không đọc được quyền':null}</div></details>}</div></div><span className={statusClass(token.status)}>{STATUS_TEXT[token.status]}</span><div className={styles.resourceMini}><span>BM <b>{invText(token.inventory?.businessCount)}</b></span><span>ADS <b>{invText(token.inventory?.adAccountCount)}</b></span><span>Page <b>{invText(token.inventory?.pageCount)}</b></span></div><div style={{display:'flex',gap:6,justifyContent:'flex-end',flexWrap:'wrap'}}><button className={styles.ghost} onClick={()=>void scanTokens([token.id])} disabled={busy}><ShieldCheck size={13}/> Check</button><button className={styles.ghost} onClick={()=>void renameToken(token)} disabled={busy}>Sửa</button><button className={styles.ghost} onClick={()=>void deleteToken(token)} disabled={busy}><Trash2 size={13}/> Xóa</button></div></div>;})}</div></>;
  }

  function renderBmCreate() {
    const current = tokens.find((t)=>t.id===selectedToken);
    const confirmed = current?.inventory?.confirmedPermissions || current?.inventory?.permissions || [];
    const inferred = current?.inventory?.inferredPermissions || [];
    return <><div className={styles.pageHead}><div><div className={styles.kicker}>RESOURCE CREATOR</div><h2>Tạo BM</h2><p>Manual, Semi-auto hoặc Auto trên đúng một token; không tự đổi tài khoản để né giới hạn Meta.</p></div></div>{alerts()}<div className={styles.formCard}>
      <div className={styles.formGrid}><label>Chế độ<select value={bmMode} onChange={(e)=>setBmMode(e.target.value as typeof bmMode)}><option value="manual">Manual</option><option value="semi_auto">Semi-auto</option><option value="auto">Auto</option></select></label><label>Nguồn (token/cookie LIVE)<select value={selectedToken} onChange={(e)=>{setSelectedToken(e.target.value);setBmReady(false);setBmPages([]);}}><option value="">Chọn nguồn LIVE</option>{liveTokens.map((t)=><option key={t.id} value={t.id}>{t.label}</option>)}</select></label></div>
      <div className={styles.permissionStrip}><span className={current?.status==='active'?styles.statusLive:styles.statusWarn}>{current?STATUS_TEXT[current.status]:'Chưa chọn'}</span>{confirmed.map((p)=><span key={`c-${p}`}>✓ Graph: {p}</span>)}{inferred.map((p)=><span key={`i-${p}`}>~ Session: {p}</span>)}</div>
      <button onClick={()=>void prepareBm()} disabled={busy||!selectedToken}><RefreshCw size={14}/> Chuẩn bị Account Snapshot</button>
      {bmReady&&<><div className={styles.formGrid}><label>Tên BM<input value={bmName} onChange={(e)=>setBmName(e.target.value)} placeholder="Tên Business"/></label>{bmMode!=='manual'&&<label>Mẫu tên<input value={bmNamePattern} onChange={(e)=>setBmNamePattern(e.target.value)} placeholder="{name} {n}"/></label>}<label>Page / BM trắng<select value={bmPage} onChange={(e)=>setBmPage(e.target.value)}><option value="">BM trắng — không Page</option>{bmPages.map((p)=><option key={p.id} value={p.id}>{p.name} · {p.id}</option>)}</select></label><label>Timezone ID<input value={bmTimezone} onChange={(e)=>setBmTimezone(e.target.value)}/></label><label>Vertical<select value={bmVertical} onChange={(e)=>setBmVertical(e.target.value)}><option>ADVERTISING</option><option>ECOMMERCE</option><option>MARKETING</option><option>TECHNOLOGY</option><option>OTHER</option></select></label>{bmMode!=='manual'&&<><label>Số lượng<input type="number" min={1} max={bmUntilLimit?100:20} value={bmCount} onChange={(e)=>setBmCount(Number(e.target.value)||1)}/></label><label>Delay (ms)<input type="number" min={0} max={30000} value={bmDelayMs} onChange={(e)=>setBmDelayMs(Number(e.target.value)||0)}/></label><label>Lỗi liên tiếp tối đa<input type="number" min={1} max={10} value={bmMaxErrors} onChange={(e)=>setBmMaxErrors(Number(e.target.value)||1)}/></label></>}</div>
      {bmMode!=='manual'&&<div className={styles.permissionStrip}><label><input type="checkbox" checked={bmContinueOnError} onChange={(e)=>setBmContinueOnError(e.target.checked)}/> Bỏ qua lỗi</label><label><input type="checkbox" checked={bmUntilLimit} onChange={(e)=>{setBmUntilLimit(e.target.checked);if(e.target.checked&&bmCount<100)setBmCount(100);}}/> Tạo tới khi chạm giới hạn</label><label><input type="checkbox" checked={bmAutoCheck} onChange={(e)=>setBmAutoCheck(e.target.checked)}/> Auto check</label><label><input type="checkbox" checked={bmAutoSync} onChange={(e)=>setBmAutoSync(e.target.checked)}/> Auto sync</label><label><input type="checkbox" checked={bmAutoLink} onChange={(e)=>setBmAutoLink(e.target.checked)}/> Auto sinh Link BM</label><label><input type="checkbox" checked={bmAutoShop} onChange={(e)=>{setBmAutoShop(e.target.checked);if(e.target.checked)setBmAutoLink(true);}}/> Auto đẩy Shop</label></div>}
      {bmUntilLimit&&bmMode!=='manual'&&<small style={{display:'block',marginTop:6,color:'#475569'}}>Sẽ tạo liên tiếp cho tới khi Meta báo đã đạt giới hạn tạo Business (subcode 1690114), khi đó batch dừng và token được đánh dấu &ldquo;Giới hạn tạo&rdquo;.</small>}
      <button onClick={()=>void createBm()} disabled={busy||!bmName}><Plus size={14}/> {bmMode==='manual'?'Tạo 1 BM':bmUntilLimit?`Chạy tới giới hạn (tối đa ${bmCount})`:`Chạy ${bmMode==='auto'?'Auto':'Semi-auto'} (${bmCount})`}</button></>}</div></>;
  }

  function renderCrm() {
    return <><div className={styles.pageHead}><div><div className={styles.kicker}>CRM GATEWAY</div><h2>Liên kết CRM</h2><p>Chưa cấu hình gateway thì đẩy CRM chỉ lưu LOCAL_ONLY trong workspace — không tự báo &quot;đã đẩy sang CRM&quot; khi chưa gửi ra ngoài. BM, ADS và Page được đẩy qua /api/crm-push.</p></div><div className={styles.actions}><button className={styles.secondary} onClick={()=>void checkCrm()} disabled={busy}><RefreshCw size={14}/> Kiểm tra kết nối</button></div></div>{alerts()}<div className={styles.formCard}><div className={styles.permissionStrip}><span className={crmConfigured===true?styles.statusLive:styles.statusUnknown}>{crmConfigured===null?'Chưa kiểm tra':crmConfigured?'CRM đã kết nối gateway':'CRM local — chưa cấu hình gateway'}</span></div><p style={{fontSize:11,color:'#6b7488'}}>Sau khi token được check/sync, bạn có thể đẩy BM/TKQC/Page từ bảng công cụ hoặc đẩy toàn bộ bên dưới.</p><button onClick={()=>void pushCrm(assets.filter((a)=>['BM','TKQC','Page'].includes(a.type)).slice(0,100).map((a)=>a.id))} disabled={busy||!assets.length}><Send size={14}/> Đẩy tối đa 100 tài nguyên hiện có</button></div></>;
  }

  function renderShop() {
    const businessAssets = assets.filter((asset)=>asset.type==='BM');
    const ready = businessAssets.filter((asset)=>asset.accessLinkStatus==='ready'&&asset.accessLink);
    return <><div className={styles.pageHead}><div><div className={styles.kicker}>SHOP ONLINE</div><h2>Đẩy BM sang Shop</h2><p>Adapter riêng; chỉ gửi metadata BM và access link, không gửi cookie, token, UID hoặc raw permissions.</p></div></div>{alerts()}<div className={styles.formCard}><div className={styles.permissionStrip}><span>BM: {businessAssets.length}</span><span>Đủ điều kiện: {ready.length}</span><span>Đã đẩy: {businessAssets.filter((asset)=>asset.shopStatus==='pushed').length}</span></div><button onClick={()=>void pushShop(ready.map((asset)=>asset.id))} disabled={busy||!ready.length}><Send size={14}/> Đẩy {ready.length} BM đủ điều kiện</button></div></>;
  }

  function renderCreate() {
    return <div className={styles.workspace}><aside className={styles.sidebar}><div className={styles.sideTitle}><Plus size={18}/><div><strong>TẠO TÀI NGUYÊN</strong><small>Token · BM · CRM · Shop</small></div></div><button className={createTab==='token'?styles.sideActive:''} onClick={()=>setCreateTab('token')}><span><KeyRound size={15}/></span><strong>Nạp & check token</strong><ChevronRight size={13}/></button><button className={createTab==='bm'?styles.sideActive:''} onClick={()=>setCreateTab('bm')}><span><Building2 size={15}/></span><strong>Tạo BM</strong><ChevronRight size={13}/></button><button className={createTab==='shop'?styles.sideActive:''} onClick={()=>setCreateTab('shop')}><span><Send size={15}/></span><strong>Shop Online</strong><ChevronRight size={13}/></button><button className={createTab==='crm'?styles.sideActive:''} onClick={()=>setCreateTab('crm')}><span><Send size={15}/></span><strong>Liên kết CRM</strong><ChevronRight size={13}/></button><div className={styles.sideNote}>Shop Online là adapter riêng và chỉ nhận BM có access link sẵn sàng.</div></aside><main className={styles.content}>{createTab==='token'?renderTokenTab():createTab==='bm'?renderBmCreate():createTab==='shop'?renderShop():renderCrm()}</main></div>;
  }

  if (mode === 'home') return <div className={styles.shell}><TopBar mode={mode} live={liveTokens.length} total={tokens.length} onMode={(next)=>void openMode(next)}/><main className={styles.home}><section className={styles.hero}><div className={styles.kicker}>ADS WORKSPACE</div><h1>Token → tài nguyên → bảng công cụ</h1><p>Không còn ổ khóa/mờ nút. Các chức năng có API hợp lệ sẽ chạy bằng token nguồn; chức năng không có luồng token-only sẽ trả thông báo rõ.</p><div className={styles.heroActions}><button onClick={()=>void openMode('create')}><Plus size={15}/> Nạp token</button><button className={styles.secondary} onClick={()=>void openMode('manage')}><ShieldCheck size={15}/> Quản lý tài nguyên</button></div></section><div className={styles.flowGrid}><article><KeyRound size={18}/><strong>1. Check token</strong><span>Token phải được Meta Graph API chấp nhận thì backend mới đồng bộ được tài nguyên.</span></article><article><Building2 size={18}/><strong>2. BM/ADS/PAGE</strong><span>Tài nguyên được gắn token nguồn để thao tác đúng quyền.</span></article><article><Sparkles size={18}/><strong>3. Công cụ mẫu</strong><span>Bảng công cụ theo từng mục ADS/BM/PAGE giống mẫu và không bị khóa giao diện.</span></article></div></main></div>;
  return <div className={styles.shell}><TopBar mode={mode} live={liveTokens.length} total={tokens.length} onMode={(next)=>void openMode(next)}/>{mode==='manage'?renderManage():renderCreate()}</div>;
}

function TopBar({ mode, live, total, onMode }: { mode: Mode; live: number; total: number; onMode: (mode: Mode)=>void }) {
  return <header className={styles.topbar}><div className={styles.brand}><Zap size={17}/><strong>ADS WORKSPACE</strong></div><nav className={styles.topnav}><button className={mode==='home'?styles.topActive:''} onClick={()=>onMode('home')}><Home size={14}/> HOME</button><button className={mode==='manage'?styles.topActive:''} onClick={()=>onMode('manage')}><ShieldCheck size={14}/> QUẢN LÝ TÀI NGUYÊN</button><button className={mode==='create'?styles.topActive:''} onClick={()=>onMode('create')}><Plus size={14}/> TẠO TÀI NGUYÊN</button></nav><div className={styles.topStatus}><span className={live?styles.liveDot:styles.deadDot}/>{live}/{total} token LIVE</div></header>;
}
