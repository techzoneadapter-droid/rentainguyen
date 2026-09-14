'use client';

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  BookOpen,
  Boxes,
  Building2,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Database,
  Factory,
  FileUp,
  Flag,
  HeartPulse,
  KeyRound,
  Layers3,
  LoaderCircle,
  Megaphone,
  PlugZap,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Workflow as WorkflowIcon,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import styles from './resource-workspace-bridge.module.css';

type Mode = 'manage' | 'create';
type TokenStatus = 'active' | 'invalid' | 'permission_issue' | 'rate_limited' | 'create_restricted' | 'unknown_error';
type ToolKey = 'tokens' | 'resources' | 'health' | 'campaigns' | 'workflow' | 'crm' | 'guides' | 'oauth' | 'bm-create' | 'queue' | 'preset';

type ToolInfo = {
  key: ToolKey;
  mode: Mode;
  label: string;
  description: string;
  icon: typeof Wrench;
  native?: boolean;
  note?: string;
};

type Inventory = {
  tokenId: string;
  status: TokenStatus;
  businessCount: number;
  pageCount: number;
  adAccountCount: number;
  liveAdCount: number;
  dieAdCount: number;
  totalResources: number;
  permissions: string[];
};

type TokenRow = {
  id: string;
  label: string;
  status: TokenStatus;
  metaUserName?: string;
  inventory: Inventory | null;
};

type AssetRow = {
  id: string;
  metaId?: string;
  name: string;
  type: string;
  status: string;
  parent?: string;
  currency?: string;
  healthNote?: string;
};

type Campaign = {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  objective?: string;
  dailyBudget?: string;
  lifetimeBudget?: string;
};

type ImportInventory = { tokenId: string; status: TokenStatus };

const BulkTokenCenter = lazy(() => import('./bulk-token-center'));
const BmTokenCreatorHub = lazy(() => import('./bm-token-creator-hub'));
const ResourceCenter = lazy(() => import('./resource-center'));
const BulkHealthCheck = lazy(() => import('./bulk-health-check'));
const ProductionQueue = lazy(() => import('./production-queue'));
const ResourcePresetManager = lazy(() => import('./resource-preset-manager'));
const GuideWorkspaceSection = lazy(() => import('./guide-workspace-section'));
const MetaOAuthConnector = lazy(() => import('./meta-oauth-connector'));
const CrmResourcePush = lazy(() => import('./crm-resource-push'));
const WorkflowRunner = lazy(() => import('./workflow-runner'));

const tools: ToolInfo[] = [
  { key: 'tokens', mode: 'manage', label: 'Nạp & phân loại token', description: 'Import token, check LIVE/DIE, quyền và tài nguyên.', icon: KeyRound },
  { key: 'resources', mode: 'manage', label: 'Trung tâm tài nguyên', description: 'BM, TKQC, Page, Pixel/Dataset đã đồng bộ từ token.', icon: Database },
  { key: 'health', mode: 'manage', label: 'Health Check', description: 'Kiểm tra trạng thái tài nguyên bằng token đã lưu.', icon: HeartPulse },
  { key: 'campaigns', mode: 'manage', label: 'Quản lý Camp', description: 'Đọc campaign và bật/tạm dừng bằng Meta Graph API.', icon: Megaphone, native: true },
  { key: 'workflow', mode: 'manage', label: 'Workflow', description: 'Workflow runner và dữ liệu vận hành hiện có.', icon: WorkflowIcon },
  { key: 'crm', mode: 'manage', label: 'Đẩy sang CRM', description: 'Luồng đẩy tài nguyên sang CRM hiện có.', icon: Send },
  { key: 'oauth', mode: 'manage', label: 'Kết nối OAuth Meta', description: 'Luồng kết nối OAuth đã có của app.', icon: PlugZap, note: 'Cần cấu hình Meta App' },
  { key: 'guides', mode: 'manage', label: 'Bí kíp / tài liệu', description: 'Kho hướng dẫn nội bộ hiện có.', icon: BookOpen },
  { key: 'bm-create', mode: 'create', label: 'Tạo BM từ token', description: 'Preflight quyền, Page đại diện, timezone, vertical và tạo BM.', icon: Building2 },
  { key: 'queue', mode: 'create', label: 'Hàng đợi tạo BM', description: 'Danh sách BM, pause/resume/retry và tiến trình.', icon: Factory },
  { key: 'preset', mode: 'create', label: 'Preset tạo tài nguyên', description: 'Lưu và dùng lại cấu hình tạo tài nguyên.', icon: SlidersHorizontal },
];

const statusLabel: Record<TokenStatus, string> = {
  active: 'LIVE', invalid: 'DIE', permission_issue: 'Thiếu quyền', rate_limited: 'Rate limit', create_restricted: 'Giới hạn tạo', unknown_error: 'Cần kiểm tra',
};

function metaId(asset: AssetRow) {
  if (asset.metaId) return String(asset.metaId);
  return asset.id.match(/:meta:(\d{5,30})$/)?.[1] || '';
}

function parseTokenText(input: string) {
  const items: Array<{ label?: string; token: string }> = [];
  const seen = new Set<string>();
  const push = (raw: string, label?: string) => {
    const token = raw.trim().replace(/^["']|["']$/g, '');
    if (token.length < 20 || token.length > 4096 || /\s/.test(token) || seen.has(token)) return;
    seen.add(token);
    items.push({ token, label: label?.trim().slice(0, 80) || undefined });
  };
  input.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    const urlToken = line.match(/[?&]access_token=([^&#\s]+)/i);
    if (urlToken) {
      push(decodeURIComponent(urlToken[1]));
      return;
    }
    const named = line.match(/(?:access_?token|token)\s*[:=]\s*["']?([^'"\s,;]+)/i);
    if (named) {
      push(named[1]);
      return;
    }
    const parts = line.split(/[|\t,;]/).map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1) push(parts.at(-1) || '', parts.slice(0, -1).join(' '));
    else push(line);
  });
  return items;
}

function LegacyTool({ tool }: { tool: ToolKey }) {
  if (tool === 'tokens') return <BulkTokenCenter />;
  if (tool === 'bm-create') return <BmTokenCreatorHub />;
  if (tool === 'resources') return <ResourceCenter />;
  if (tool === 'health') return <BulkHealthCheck />;
  if (tool === 'queue') return <ProductionQueue />;
  if (tool === 'preset') return <ResourcePresetManager />;
  if (tool === 'guides') return <GuideWorkspaceSection />;
  if (tool === 'oauth') return <MetaOAuthConnector />;
  if (tool === 'crm') return <CrmResourcePush />;
  return <WorkflowRunner />;
}

function CampaignManager({ tokens, assets, selectedToken, setSelectedToken }: {
  tokens: TokenRow[];
  assets: AssetRow[];
  selectedToken: string;
  setSelectedToken: (value: string) => void;
}) {
  const adAccounts = useMemo(() => assets.filter((asset) => asset.type === 'TKQC' && metaId(asset)), [assets]);
  const [accountId, setAccountId] = useState('');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const effectiveAccountId = accountId || (adAccounts[0] ? metaId(adAccounts[0]) : '');

  async function loadCampaigns() {
    if (!selectedToken || !effectiveAccountId) {
      setError('Chọn token LIVE và tài khoản quảng cáo trước.');
      return;
    }
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/ez-ads?tokenId=${encodeURIComponent(selectedToken)}&accountId=${encodeURIComponent(effectiveAccountId)}`, { cache: 'no-store' });
      const data = await response.json() as { campaigns?: Campaign[]; error?: string };
      if (!response.ok) throw new Error(data.error || 'Không đọc được campaign.');
      setCampaigns(data.campaigns || []);
      setMessage(`Đã tải ${data.campaigns?.length || 0} campaign.`);
    } catch (err) {
      setCampaigns([]);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(campaign: Campaign, status: 'ACTIVE' | 'PAUSED') {
    if (!selectedToken || !effectiveAccountId) return;
    setBusyId(campaign.id);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/ez-ads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId: selectedToken, accountId: effectiveAccountId, campaignId: campaign.id, status }),
      });
      const data = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error || 'Không cập nhật được campaign.');
      setMessage(data.message || `Đã cập nhật ${campaign.name}.`);
      await loadCampaigns();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId('');
    }
  }

  const filtered = campaigns.filter((campaign) => `${campaign.name} ${campaign.id} ${campaign.status} ${campaign.effectiveStatus}`.toLowerCase().includes(query.toLowerCase()));

  return <div className={styles.nativeToolPage}>
    <div className={styles.pageHeading}>
      <div><span className={styles.eyebrow}>META GRAPH API</span><h1>Quản lý Camp</h1><p>Đọc campaign của TKQC đã đồng bộ và bật/tạm dừng bằng token bạn đã nạp.</p></div>
      <button className={styles.primaryButton} type="button" onClick={() => void loadCampaigns()} disabled={loading || !selectedToken || !effectiveAccountId}>{loading ? <LoaderCircle className={styles.spin} size={16} /> : <RefreshCw size={16} />} Tải campaign</button>
    </div>
    <div className={styles.campaignControls}>
      <label>Token<select value={selectedToken} onChange={(event) => setSelectedToken(event.target.value)}><option value="">Chọn token</option>{tokens.map((token) => <option key={token.id} value={token.id}>{token.label} · {statusLabel[token.status]}</option>)}</select></label>
      <label>TKQC<select value={effectiveAccountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Chọn TKQC</option>{adAccounts.map((asset) => <option key={asset.id} value={metaId(asset)}>{asset.name} · {metaId(asset)}</option>)}</select></label>
      <label className={styles.searchField}>Tìm campaign<span><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên / ID / trạng thái" /></span></label>
    </div>
    {message && <div className={styles.successBanner}><CheckCircle2 size={16} />{message}</div>}
    {error && <div className={styles.errorBanner}><Activity size={16} />{error}</div>}
    <div className={styles.campaignTable}>
      <div className={styles.campaignHeader}><span>Campaign</span><span>Trạng thái</span><span>Effective</span><span>Objective</span><span>Budget</span><span>Thao tác</span></div>
      {filtered.length === 0 ? <div className={styles.emptyCampaign}>Chưa có dữ liệu campaign. Chọn token + TKQC rồi bấm “Tải campaign”.</div> : filtered.map((campaign) => <div className={styles.campaignRow} key={campaign.id}>
        <span><strong>{campaign.name}</strong><small>{campaign.id}</small></span>
        <span><b className={campaign.status === 'ACTIVE' ? styles.liveBadge : styles.neutralBadge}>{campaign.status || '—'}</b></span>
        <span>{campaign.effectiveStatus || '—'}</span><span>{campaign.objective || '—'}</span>
        <span>{campaign.dailyBudget ? `Daily ${campaign.dailyBudget}` : campaign.lifetimeBudget ? `Lifetime ${campaign.lifetimeBudget}` : '—'}</span>
        <span className={styles.rowActions}><button type="button" disabled={busyId === campaign.id || campaign.status === 'ACTIVE'} onClick={() => void updateStatus(campaign, 'ACTIVE')}>Bật</button><button type="button" disabled={busyId === campaign.id || campaign.status === 'PAUSED'} onClick={() => void updateStatus(campaign, 'PAUSED')}>Tạm dừng</button></span>
      </div>)}
    </div>
  </div>;
}

export default function ResourceWorkspaceBridge() {
  const [topMount, setTopMount] = useState<Element | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [activeTool, setActiveTool] = useState<ToolKey | null>(null);
  const navHostRef = useRef<HTMLElement | null>(null);
  const headerHostRef = useRef<HTMLElement | null>(null);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [selectedToken, setSelectedToken] = useState('');
  const [rawTokens, setRawTokens] = useState('');
  const [fileName, setFileName] = useState('');
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const activeInfo = useMemo(() => tools.find((tool) => tool.key === activeTool) || null, [activeTool]);
  const modeTools = useMemo(() => tools.filter((tool) => tool.mode === mode), [mode]);
  const liveTokens = useMemo(() => tokens.filter((token) => token.status === 'active'), [tokens]);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const [tokenResponse, workspaceResponse] = await Promise.all([fetch('/api/token-inventory', { cache: 'no-store' }), fetch('/api/workspace', { cache: 'no-store' })]);
      const tokenData = await tokenResponse.json() as { tokens?: TokenRow[]; error?: string };
      const workspaceData = await workspaceResponse.json() as { assets?: AssetRow[]; error?: string };
      if (!tokenResponse.ok) throw new Error(tokenData.error || 'Không tải được token.');
      if (!workspaceResponse.ok) throw new Error(workspaceData.error || 'Không tải được tài nguyên.');
      const nextTokens = tokenData.tokens || [];
      setTokens(nextTokens);
      setAssets(workspaceData.assets || []);
      setSelectedToken((current) => current && nextTokens.some((token) => token.id === current) ? current : nextTokens.find((token) => token.status === 'active')?.id || nextTokens[0]?.id || '');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  useEffect(() => {
    let ownedMount: HTMLElement | null = null;
    const attach = () => {
      const homeButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'HOME');
      const rail = homeButton?.parentElement;
      if (!rail) return;
      let mount = rail.querySelector<HTMLElement>('[data-resource-mode-tabs="1"]');
      if (!mount) {
        mount = document.createElement('span');
        mount.dataset.resourceModeTabs = '1';
        mount.style.display = 'contents';
        const groupButton = Array.from(rail.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'GROUP');
        rail.insertBefore(mount, groupButton?.nextSibling || null);
        ownedMount = mount;
      }
      setTopMount((current) => current === mount ? current : mount);
    };
    const kickoff = window.setTimeout(attach, 0);
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { window.clearTimeout(kickoff); observer.disconnect(); if (ownedMount?.isConnected) ownedMount.remove(); };
  }, []);

  useEffect(() => {
    if (!activeTool || activeInfo?.native) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const buttons = [...Array.from(navHostRef.current?.querySelectorAll('button') || []), ...Array.from(headerHostRef.current?.querySelectorAll('button') || [])].filter((button) => button.dataset.bridgeAnchor !== '1' && button.dataset.bridgeAutoClicked !== '1');
      const button = buttons[0];
      if (button) { button.dataset.bridgeAutoClicked = '1'; button.click(); window.clearInterval(timer); }
      else if (attempts >= 50) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [activeTool, activeInfo?.native]);

  function openMode(next: Mode) {
    setMode(next); setActiveTool(null); setMessage(''); setError(''); void loadOverview();
  }

  function openTool(tool: ToolInfo) {
    setMode(tool.mode); setActiveTool(tool.key); setMessage(''); setError(''); void loadOverview();
  }

  useEffect(() => {
    const routeClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>('button');
      if (!button || button.closest('[data-resource-bridge="1"]')) return;
      const text = button.textContent?.replace(/\s+/g, ' ').trim() || '';
      const mapping: Record<string, { mode: Mode; tool: ToolKey }> = {
        'Phân loại token': { mode: 'manage', tool: 'tokens' }, 'Trung tâm tài nguyên': { mode: 'manage', tool: 'resources' }, 'Workflow': { mode: 'manage', tool: 'workflow' }, 'Quản lý Camp': { mode: 'manage', tool: 'campaigns' },
        'Quản lý TKQC': { mode: 'manage', tool: 'resources' }, 'Quản lý Pixel': { mode: 'manage', tool: 'resources' }, 'Quản lý BM': { mode: 'manage', tool: 'resources' }, 'Quản lý Page': { mode: 'manage', tool: 'resources' }, 'Tạo BM': { mode: 'create', tool: 'bm-create' },
      };
      const mapped = mapping[text];
      if (!mapped) return;
      event.preventDefault(); event.stopPropagation(); setMode(mapped.mode); setActiveTool(mapped.tool); setMessage(''); setError(''); void loadOverview();
    };
    document.addEventListener('click', routeClick, true);
    return () => document.removeEventListener('click', routeClick, true);
  }, [loadOverview]);

  async function onTokenFile(file: File | null) {
    setFileName(file?.name || ''); setError('');
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('File token tối đa 5 MB.'); return; }
    setRawTokens(await file.text());
  }

  async function quickImportAndSync() {
    const items = parseTokenText(rawTokens);
    if (!items.length) { setError('Dán token hoặc chọn file token trước.'); return; }
    if (items.length > 200) { setError('Mỗi lượt tối đa 200 token để hạn chế rate limit.'); return; }
    setBusy(true); setError(''); setMessage('');
    const liveIds = new Set<string>(); let imported = 0; let reused = 0; let syncedTokens = 0; let importedResources = 0; const syncErrors: string[] = [];
    try {
      for (let index = 0; index < items.length; index += 20) {
        const chunk = items.slice(index, index + 20); setProgress(`Đang check token ${index + 1}–${index + chunk.length}/${items.length}…`);
        const response = await fetch('/api/token-inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import', items: chunk }) });
        const data = await response.json() as { imported?: number; reused?: number; inventories?: ImportInventory[]; error?: string };
        if (!response.ok) throw new Error(data.error || 'Nạp token thất bại.');
        imported += data.imported || 0; reused += data.reused || 0; (data.inventories || []).filter((item) => item.status === 'active').forEach((item) => liveIds.add(item.tokenId));
      }
      const ids = Array.from(liveIds);
      for (let index = 0; index < ids.length; index += 1) {
        setProgress(`Token LIVE ${index + 1}/${ids.length}: đang đồng bộ BM/TKQC/Page/Pixel…`);
        try {
          const response = await fetch('/api/resource-create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import_token', tokenId: ids[index] }) });
          const data = await response.json() as { imported?: number; error?: string };
          if (!response.ok) throw new Error(data.error || 'Không đồng bộ được tài nguyên.');
          syncedTokens += 1; importedResources += data.imported || 0;
        } catch (err) { syncErrors.push((err as Error).message); }
      }
      setRawTokens(''); setFileName(''); await loadOverview();
      setMessage(`Đã xử lý ${items.length} token · mới ${imported} · có sẵn ${reused} · LIVE ${ids.length} · đồng bộ ${syncedTokens} token / ${importedResources} tài nguyên.${syncErrors.length ? ` ${syncErrors.length} token chưa đồng bộ được; mở Kho token để xem lỗi/quyền.` : ''}`);
    } catch (err) { setError((err as Error).message); }
    finally { setProgress(''); setBusy(false); }
  }

  async function syncSelectedToken() {
    if (!selectedToken) { setError('Chọn token trước.'); return; }
    setBusy(true); setError(''); setMessage(''); setProgress('Đang đồng bộ tài nguyên từ token đã chọn…');
    try {
      const response = await fetch('/api/resource-create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import_token', tokenId: selectedToken }) });
      const data = await response.json() as { imported?: number; message?: string; error?: string };
      if (!response.ok) throw new Error(data.error || 'Không đồng bộ được tài nguyên.');
      setMessage(data.message || `Đã đồng bộ ${data.imported || 0} tài nguyên.`); await loadOverview();
    } catch (err) { setError((err as Error).message); }
    finally { setProgress(''); setBusy(false); }
  }

  const stats = useMemo(() => ({ token: tokens.length, live: liveTokens.length, bm: assets.filter((asset) => asset.type === 'BM').length, ads: assets.filter((asset) => asset.type === 'TKQC').length, page: assets.filter((asset) => asset.type === 'Page').length, pixel: assets.filter((asset) => asset.type === 'Dataset/Pixel').length }), [assets, liveTokens.length, tokens.length]);
  const topTabs = topMount ? createPortal(<><button data-resource-bridge="1" type="button" className={`${styles.topModeButton} ${mode === 'manage' ? styles.topModeActive : ''}`} onClick={() => openMode('manage')}>QUẢN LÝ TÀI NGUYÊN</button><button data-resource-bridge="1" type="button" className={`${styles.topModeButton} ${mode === 'create' ? styles.topModeActive : ''}`} onClick={() => openMode('create')}>TẠO TÀI NGUYÊN</button></>, topMount) : null;
  const isLegacyTool = Boolean(activeTool && activeInfo && !activeInfo.native);
  const ActiveIcon = activeInfo?.icon;

  return <>
    {topTabs}
    <aside data-legacy-tool-target="1" className={`sidebar ${styles.hiddenTarget}`} aria-hidden="true"><nav ref={navHostRef} /></aside>
    <div className={`main-wrap ${styles.compatMain} ${isLegacyTool ? styles.compatOpen : ''}`} aria-hidden={isLegacyTool ? undefined : true}><header ref={headerHostRef} className={styles.hiddenTarget}><button type="button" data-bridge-anchor="1">Token</button></header></div>

    {mode && <div data-resource-bridge="1" className={styles.modeLayer}>
      <aside className={styles.modeSidebar}>
        <div className={styles.modeBrand}><span><Zap size={19} /></span><div><strong>{mode === 'manage' ? 'QUẢN LÝ TÀI NGUYÊN' : 'TẠO TÀI NGUYÊN'}</strong><small>ADS WORKSPACE</small></div><button type="button" aria-label="Đóng" onClick={() => { setMode(null); setActiveTool(null); }}><X size={16} /></button></div>
        <button type="button" className={`${styles.sideItem} ${activeTool === null ? styles.sideActive : ''}`} onClick={() => setActiveTool(null)}><span><Boxes size={17} /></span><strong>Tổng quan</strong></button>
        <div className={styles.sideLabel}>{mode === 'manage' ? 'VẬN HÀNH TÀI NGUYÊN' : 'LUỒNG TẠO'}</div>
        {modeTools.map((tool) => { const Icon = tool.icon; return <button type="button" key={tool.key} className={`${styles.sideItem} ${activeTool === tool.key ? styles.sideActive : ''}`} onClick={() => openTool(tool)}><span><Icon size={17} /></span><strong>{tool.label}</strong><ChevronRight size={14} /></button>; })}
        <div className={styles.modeSidebarBottom}><div><span className={liveTokens.length ? styles.onlineDot : styles.offlineDot} /><strong>{liveTokens.length}/{tokens.length} token LIVE</strong></div><small>{assets.length} tài nguyên đã đồng bộ</small><button type="button" onClick={() => openMode(mode === 'manage' ? 'create' : 'manage')}>{mode === 'manage' ? 'Chuyển sang Tạo tài nguyên' : 'Chuyển sang Quản lý tài nguyên'}</button></div>
      </aside>

      {!activeTool && <main className={styles.hubMain}>
        <div className={styles.hubHeader}><div><span className={styles.eyebrow}>{mode === 'manage' ? 'RESOURCE OPERATIONS' : 'RESOURCE FACTORY'}</span><h1>{mode === 'manage' ? 'Quản lý tài nguyên' : 'Tạo tài nguyên'}</h1><p>{mode === 'manage' ? 'Nạp token một lần, hệ thống check token rồi tự đồng bộ BM, TKQC, Page và Pixel. Các công cụ bên dưới dùng chung kho token này.' : 'Tất cả luồng tạo hiện có được gom tại đây và dùng trực tiếp kho token đã nạp ở mục Quản lý tài nguyên.'}</p></div><button className={styles.secondaryButton} type="button" onClick={() => void loadOverview()} disabled={loadingOverview}>{loadingOverview ? <LoaderCircle className={styles.spin} size={16} /> : <RefreshCw size={16} />} Làm mới</button></div>
        {message && <div className={styles.successBanner}><CheckCircle2 size={16} />{message}<button type="button" onClick={() => setMessage('')}><X size={14} /></button></div>}
        {error && <div className={styles.errorBanner}><Activity size={16} />{error}<button type="button" onClick={() => setError('')}><X size={14} /></button></div>}
        {progress && <div className={styles.progressBanner}><LoaderCircle className={styles.spin} size={16} />{progress}</div>}
        <div className={styles.statsGrid}><div><KeyRound /><span><small>Tổng token</small><strong>{stats.token}</strong></span></div><div><ShieldCheck /><span><small>Token LIVE</small><strong>{stats.live}</strong></span></div><div><Building2 /><span><small>Business Manager</small><strong>{stats.bm}</strong></span></div><div><CreditCard /><span><small>TKQC</small><strong>{stats.ads}</strong></span></div><div><Flag /><span><small>Page</small><strong>{stats.page}</strong></span></div><div><Layers3 /><span><small>Pixel / Dataset</small><strong>{stats.pixel}</strong></span></div></div>
        {mode === 'manage' ? <section className={styles.quickStart}><div className={styles.quickStartHead}><div><span><KeyRound size={19} /></span><div><strong>Nạp token & chạy ngay</strong><small>Token được check trước; chỉ token LIVE mới đồng bộ tài nguyên. Không tự retry khi Meta báo rate limit/lỗi.</small></div></div><button type="button" className={styles.primaryButton} onClick={() => void quickImportAndSync()} disabled={busy || !rawTokens.trim()}>{busy ? <LoaderCircle className={styles.spin} size={16} /> : <Zap size={16} />} Nạp token & đồng bộ</button></div><div className={styles.quickGrid}><label>Token<textarea value={rawTokens} onChange={(event) => setRawTokens(event.target.value)} placeholder={'Mỗi dòng một token\nhoặc ten-token|token'} /></label><div className={styles.quickSide}><label className={styles.fileBox}><FileUp size={21} /><strong>{fileName || 'Chọn file token'}</strong><small>TXT, CSV, TSV, JSON hoặc file text tối đa 5 MB</small><input type="file" onChange={(event) => void onTokenFile(event.target.files?.[0] || null)} /></label><label>Token đang dùng<select value={selectedToken} onChange={(event) => setSelectedToken(event.target.value)}><option value="">Chọn token</option>{tokens.map((token) => <option value={token.id} key={token.id}>{token.label} · {statusLabel[token.status]}</option>)}</select></label><button className={styles.secondaryButton} type="button" onClick={() => void syncSelectedToken()} disabled={busy || !selectedToken}><RefreshCw size={15} /> Đồng bộ lại token đang chọn</button></div></div></section> : <section className={styles.createReady}><div><Building2 size={25} /><div><strong>Kho token dùng chung</strong><small>Công cụ tạo BM/hàng đợi đọc trực tiếp token đã nạp ở Quản lý tài nguyên.</small></div></div><select value={selectedToken} onChange={(event) => setSelectedToken(event.target.value)}><option value="">Chọn token</option>{tokens.map((token) => <option value={token.id} key={token.id}>{token.label} · {statusLabel[token.status]}</option>)}</select>{!liveTokens.length && <button type="button" onClick={() => { setMode('manage'); setActiveTool('tokens'); void loadOverview(); }}>Chưa có token LIVE · Nạp token</button>}</section>}
        <div className={styles.sectionHeading}><Wrench size={17} /><div><strong>{mode === 'manage' ? 'Công cụ quản lý' : 'Công cụ tạo tài nguyên'}</strong><small>Chỉ hiển thị các luồng đã có backend/API thật trong app.</small></div></div>
        <div className={styles.toolGrid}>{modeTools.map((tool) => { const Icon = tool.icon; return <button type="button" className={styles.toolCard} key={tool.key} onClick={() => openTool(tool)}><span className={styles.toolCardIcon}><Icon size={21} /></span><span><strong>{tool.label}</strong><small>{tool.description}</small></span><i>{tool.note || 'Sẵn sàng'}</i><ChevronRight size={16} /></button>; })}</div>
      </main>}

      {activeTool && activeInfo?.native && <main className={styles.nativeMain}><CampaignManager tokens={tokens} assets={assets} selectedToken={selectedToken} setSelectedToken={setSelectedToken} /></main>}
      {activeTool && activeInfo && !activeInfo.native && <><div className={styles.toolTopBar}><div>{ActiveIcon && <ActiveIcon size={16} />}<strong>{activeInfo.label}</strong></div><button type="button" onClick={() => setActiveTool(null)}>Về tổng quan</button></div><Suspense fallback={<div className={styles.loading}>Đang nạp {activeInfo.label}…</div>}><LegacyTool tool={activeTool} /></Suspense></>}
    </div>}
  </>;
}
