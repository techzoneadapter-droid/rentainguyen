'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertTriangle,
  Bot,
  Boxes,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  CreditCard,
  Database,
  Download,
  ExternalLink,
  Flag,
  FolderKanban,
  HeartPulse,
  History,
  KeyRound,
  LayoutDashboard,
  Library,
  Link2,
  ListChecks,
  LoaderCircle,
  Mail,
  Megaphone,
  Menu,
  MessageSquare,
  Monitor,
  Moon,
  PenSquare,
  RefreshCw,
  ScanLine,
  Search,
  Send,
  Settings,
  Shield,
  ShieldCheck,
  Sun,
  UserPlus,
  UserRound,
  Users,
  UserSearch,
  WandSparkles,
  Workflow,
  X,
} from 'lucide-react';
import type { Asset, Entry } from '../lib/data';
import styles from './eztool-dashboard.module.css';

type TokenStatus = 'active' | 'invalid' | 'permission_issue' | 'rate_limited' | 'create_restricted' | 'unknown_error';
type TokenItem = {
  id: string;
  label: string;
  status: TokenStatus;
  metaUserId?: string;
  metaUserName?: string;
  fingerprint?: string;
  lastError?: string;
};

type WorkspaceResponse = {
  assets?: Asset[];
  jobs?: Entry[];
  logs?: Entry[];
  services?: Entry[];
  connected?: boolean;
  error?: string;
};

type Campaign = {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  objective?: string;
  dailyBudget?: string;
  lifetimeBudget?: string;
  createdTime?: string;
  updatedTime?: string;
};

type NavItem = {
  key: string;
  label: string;
  icon: LucideIcon;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const sections: NavSection[] = [
  {
    label: 'MAIN',
    items: [
      { key: 'home', label: 'Trang chủ', icon: LayoutDashboard },
    ],
  },
  {
    label: 'PROFILE',
    items: [
      { key: 'profile', label: 'Quản lý Profile', icon: UserRound },
      { key: 'profile-posts', label: 'Quản lý bài viết', icon: PenSquare },
      { key: 'profile-friends', label: 'Quản lý bạn bè', icon: Users },
      { key: 'profile-optimize', label: 'Tối ưu Facebook', icon: Shield },
    ],
  },
  {
    label: 'ADS',
    items: [
      { key: 'ads', label: 'Quản lý TKQC', icon: CreditCard },
      { key: 'pixels', label: 'Quản lý Pixel', icon: ScanLine },
      { key: 'campaigns', label: 'Quản lý Camp', icon: Megaphone },
    ],
  },
  {
    label: 'BM',
    items: [
      { key: 'bm', label: 'Quản lý BM', icon: Building2 },
      { key: 'bm-check', label: 'Check BM', icon: ShieldCheck },
      { key: 'bm-sync', label: 'Đồng bộ BM', icon: RefreshCw },
      { key: 'bm-links', label: 'Quản lý link BM', icon: Link2 },
    ],
  },
  {
    label: 'CONTENT',
    items: [
      { key: 'content-groups', label: 'Đăng bài nhóm', icon: Send },
      { key: 'content-pages', label: 'Đăng bài trang', icon: Flag },
      { key: 'content-manage', label: 'Quản lý bài đăng', icon: ClipboardList },
      { key: 'content-library', label: 'Thư viện nội dung', icon: Library },
      { key: 'content-reply', label: 'Trả lời tự động', icon: Bot },
    ],
  },
  {
    label: 'PAGE',
    items: [
      { key: 'pages', label: 'Quản lý Page', icon: Flag },
      { key: 'page-messages', label: 'Quản lý tin nhắn', icon: MessageSquare },
      { key: 'page-uid', label: 'Quét UID tương tác', icon: UserSearch },
    ],
  },
  {
    label: 'GROUP',
    items: [
      { key: 'groups', label: 'Quản lý Group', icon: Users },
      { key: 'group-user-scan', label: 'Quét nhóm người dùng', icon: UserSearch },
      { key: 'group-member-scan', label: 'Quét thành viên nhóm', icon: Users },
      { key: 'group-find', label: 'Tìm & Tham gia nhóm', icon: UserPlus },
    ],
  },
  {
    label: 'TIỆN ÍCH',
    items: [
      { key: 'temp-mail', label: 'Email tạm thời', icon: Mail },
      { key: 'uid', label: 'Tra cứu UID', icon: Search },
      { key: 'video', label: 'Video Downloader', icon: Download },
      { key: 'text', label: 'Xử lý Text', icon: WandSparkles },
    ],
  },
  {
    label: 'HỖ TRỢ',
    items: [
      { key: 'logs', label: 'Nhật ký hoạt động', icon: History },
      { key: 'settings', label: 'Cài đặt', icon: Settings },
    ],
  },
];

const extraTools = [
  { label: 'Tạo BM', matches: ['Tạo BM từ token'] },
  { label: 'Tài nguyên', matches: ['Trung tâm tài nguyên'] },
  { label: 'Hàng đợi', matches: ['Hàng đợi'] },
  { label: 'Preset', matches: ['Preset'] },
  { label: 'Bí kíp', matches: ['Bí kíp'] },
  { label: 'Token', matches: ['Token'] },
  { label: 'OAuth', matches: ['OAuth'] },
  { label: 'CRM', matches: ['CRM'] },
  { label: 'Workflow', matches: ['Workflow'] },
];

const tokenLabels: Record<TokenStatus, string> = {
  active: 'Hoạt động',
  invalid: 'Không hợp lệ',
  permission_issue: 'Thiếu quyền',
  rate_limited: 'Rate limit',
  create_restricted: 'Giới hạn tạo BM',
  unknown_error: 'Cần kiểm tra',
};

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (['live', 'truy cập được', 'active', 'hoạt động', 'verified'].some((value) => normalized.includes(value))) return styles.good;
  if (['die', 'invalid', 'vô hiệu', 'disabled', 'failed'].some((value) => normalized.includes(value))) return styles.bad;
  if (['hạn chế', 'rate', 'pending', 'chờ', 'restricted'].some((value) => normalized.includes(value))) return styles.warn;
  return styles.neutral;
}

function metaId(asset: Asset) {
  if (asset.metaId) return asset.metaId;
  const match = asset.id.match(/meta:(\d{5,30})$/);
  return match?.[1] || asset.id;
}

function parentName(asset: Asset, assets: Asset[]) {
  if (!asset.parent) return '—';
  return assets.find((item) => item.id === asset.parent)?.name || asset.parent;
}

function dateText(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
}

export default function EztoolDashboard() {
  const [view, setView] = useState('home');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [jobs, setJobs] = useState<Entry[]>([]);
  const [logs, setLogs] = useState<Entry[]>([]);
  const [services, setServices] = useState<Entry[]>([]);
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [selectedToken, setSelectedToken] = useState('');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [accountId, setAccountId] = useState('');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [uidInput, setUidInput] = useState('');
  const [uidResult, setUidResult] = useState('');
  const [textInput, setTextInput] = useState('');
  const [textOutput, setTextOutput] = useState('');

  const activeItem = useMemo(
    () => sections.flatMap((section) => section.items).find((item) => item.key === view),
    [view],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [workspaceResponse, tokenResponse] = await Promise.all([
        fetch('/api/workspace', { cache: 'no-store' }),
        fetch('/api/meta-tokens', { cache: 'no-store' }),
      ]);
      const workspaceData = await workspaceResponse.json() as WorkspaceResponse;
      const tokenData = await tokenResponse.json() as { tokens?: TokenItem[]; error?: string };
      if (!workspaceResponse.ok) throw new Error(workspaceData.error || 'Không tải được workspace.');
      if (!tokenResponse.ok) throw new Error(tokenData.error || 'Không tải được token.');
      const nextAssets = workspaceData.assets || [];
      const nextTokens = tokenData.tokens || [];
      setAssets(nextAssets);
      setJobs(workspaceData.jobs || []);
      setLogs(workspaceData.logs || []);
      setServices(workspaceData.services || []);
      setConnected(Boolean(workspaceData.connected));
      setTokens(nextTokens);
      setSelectedToken((current) => current && nextTokens.some((token) => token.id === current)
        ? current
        : nextTokens.find((token) => token.status === 'active')?.id || nextTokens[0]?.id || '');
      setAccountId((current) => current || metaId(nextAssets.find((item) => item.type === 'TKQC') || ({ id: '' } as Asset)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function selectView(next: string) {
    setView(next);
    setMobileMenu(false);
    setError('');
    setToast('');
  }

  function openExtra(matches: string[]) {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar nav button'));
    const target = buttons.find((button) => {
      const text = button.textContent?.trim().toLowerCase() || '';
      return matches.some((match) => text.includes(match.toLowerCase()));
    });
    if (target) {
      target.click();
      setMobileMenu(false);
      return;
    }
    setToast('Công cụ đang khởi tạo. Hãy thử lại sau khi trang tải xong.');
  }

  async function importFromToken() {
    if (!selectedToken) {
      setError('Chọn token trước khi đồng bộ.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/resource-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import_token', tokenId: selectedToken }),
      });
      const data = await response.json() as { error?: string; message?: string; imported?: number };
      if (!response.ok) throw new Error(data.error || 'Không đồng bộ được tài nguyên từ token.');
      setToast(data.message || `Đã đồng bộ ${data.imported || 0} tài nguyên.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function healthCheck(type?: string) {
    const ids = assets
      .filter((asset) => !type || asset.type === type)
      .slice(0, 100)
      .map((asset) => asset.id);
    if (!ids.length) {
      setError('Chưa có tài nguyên phù hợp để kiểm tra.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/resource-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, tokenId: selectedToken || undefined }),
      });
      const data = await response.json() as { error?: string; message?: string; summary?: { total?: number; live?: number; die?: number } };
      if (!response.ok) throw new Error(data.error || 'Health Check thất bại.');
      const summary = data.summary;
      setToast(summary ? `Đã kiểm tra ${summary.total || ids.length} tài nguyên · LIVE ${summary.live || 0} · DIE ${summary.die || 0}` : data.message || 'Đã kiểm tra xong.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function loadCampaigns() {
    if (!selectedToken || !/^\d{5,30}$/.test(accountId)) {
      setError('Chọn token và một tài khoản quảng cáo hợp lệ trước.');
      return;
    }
    setCampaignLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/ez-ads?tokenId=${encodeURIComponent(selectedToken)}&accountId=${encodeURIComponent(accountId)}`, { cache: 'no-store' });
      const data = await response.json() as { campaigns?: Campaign[]; error?: string };
      if (!response.ok) throw new Error(data.error || 'Không đọc được campaign.');
      setCampaigns(data.campaigns || []);
      setToast(`Đã đọc ${data.campaigns?.length || 0} campaign từ Meta.`);
    } catch (err) {
      setError((err as Error).message);
      setCampaigns([]);
    } finally {
      setCampaignLoading(false);
    }
  }

  const filteredAssets = useCallback((type?: string) => {
    const needle = globalSearch.trim().toLowerCase();
    return assets.filter((asset) => {
      if (type && asset.type !== type) return false;
      if (!needle) return true;
      return `${asset.name} ${metaId(asset)} ${asset.status} ${asset.country} ${asset.tier}`.toLowerCase().includes(needle);
    });
  }, [assets, globalSearch]);

  const counts = useMemo(() => ({
    bm: assets.filter((item) => item.type === 'BM').length,
    ads: assets.filter((item) => item.type === 'TKQC').length,
    pages: assets.filter((item) => item.type === 'Page').length,
    pixels: assets.filter((item) => item.type === 'Dataset/Pixel').length,
    live: assets.filter((item) => item.status === 'LIVE' || item.status === 'Truy cập được').length,
    attention: assets.filter((item) => ['DIE', 'Hạn chế', 'Không xác định', 'Cần kiểm tra quyền'].includes(item.status)).length,
  }), [assets]);

  const selectedTokenRecord = tokens.find((token) => token.id === selectedToken);

  function assetTable(type: string, title: string, subtitle: string) {
    const rows = filteredAssets(type);
    return (
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <div className={styles.actions}>
            <button className="button" type="button" disabled={busy} onClick={() => void healthCheck(type)}>
              <HeartPulse size={16} /> Check trạng thái
            </button>
            <button className="button primary" type="button" disabled={busy || !selectedToken} onClick={() => void importFromToken()}>
              {busy ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />} Đồng bộ
            </button>
          </div>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>Tài nguyên</th><th>Trạng thái</th><th>BM liên kết</th><th>Quốc gia</th><th>Phân loại</th><th>Hạn mức</th><th>Kiểm tra</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className={styles.empty}>Đang tải dữ liệu…</td></tr> : rows.length === 0 ? <tr><td colSpan={7} className={styles.empty}>Chưa có dữ liệu. Chọn token và bấm Đồng bộ.</td></tr> : rows.map((asset) => (
                <tr key={asset.id}>
                  <td><strong>{asset.name}</strong><small>{metaId(asset)}</small></td>
                  <td><span className={`${styles.status} ${statusTone(asset.status)}`}>{asset.status}</span></td>
                  <td>{parentName(asset, assets)}</td>
                  <td>{asset.country || '—'}</td>
                  <td>{asset.tier || '—'}</td>
                  <td>{asset.limit || '—'}</td>
                  <td>{dateText(asset.checked)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  function unavailable(title: string, description: string, notes: string[]) {
    return (
      <section className={styles.panel}>
        <div className={styles.emptyState}>
          <Shield size={34} />
          <h2>{title}</h2>
          <p>{description}</p>
          <div className={styles.noteGrid}>
            {notes.map((note) => <div key={note}><CheckCircle2 size={15} />{note}</div>)}
          </div>
        </div>
      </section>
    );
  }

  function renderHome() {
    const stats = [
      ['Business Manager', counts.bm, Building2],
      ['Tài khoản QC', counts.ads, CreditCard],
      ['Fanpage', counts.pages, Flag],
      ['Pixel / Dataset', counts.pixels, ScanLine],
    ] as const;
    return (
      <>
        <div className={styles.heroRow}>
          <div>
            <span className={styles.eyebrow}>META OPERATIONS</span>
            <h1>Quản lý tài nguyên Facebook tập trung</h1>
            <p>Giao diện được gom theo đúng nhóm công việc: Profile, Ads, BM, Content, Page, Group và Tiện ích; màu chủ đạo của app vẫn giữ nguyên.</p>
          </div>
          <div className={styles.actions}>
            <button className="button" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> Làm mới</button>
            <button className="button primary" type="button" onClick={() => openExtra(['Tạo BM từ token'])}><Building2 size={16} /> Tạo BM</button>
          </div>
        </div>
        <section className={styles.statGrid}>
          {stats.map(([label, value, Icon]) => <button key={label} className={styles.statCard} type="button" onClick={() => selectView(label === 'Business Manager' ? 'bm' : label === 'Tài khoản QC' ? 'ads' : label === 'Fanpage' ? 'pages' : 'pixels')}><span><Icon size={19} /></span><strong>{value}</strong><small>{label}</small></button>)}
        </section>
        <div className={styles.homeGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>Chất lượng tài khoản</h2><p>Tổng hợp từ token và trạng thái tài nguyên hiện có.</p></div><Activity size={20} /></div>
            <div className={styles.qualityBox}>
              <div className={styles.qualityScore}>{assets.length ? Math.max(0, Math.round((counts.live / Math.max(assets.length, 1)) * 100)) : 100}<span>%</span></div>
              <div><strong>{counts.live} tài nguyên ổn định</strong><p>{counts.attention} tài nguyên cần chú ý · {tokens.filter((token) => token.status === 'active').length}/{tokens.length} token đang hoạt động.</p></div>
            </div>
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>Thao tác nhanh</h2><p>Các luồng đang có sẵn trong app của bạn.</p></div><Boxes size={20} /></div>
            <div className={styles.quickGrid}>
              <button type="button" onClick={() => openExtra(['Trung tâm tài nguyên'])}><Database size={18} /><span><strong>Trung tâm tài nguyên</strong><small>LIVE/DIE, vòng đời, CRM</small></span><ChevronRight size={15} /></button>
              <button type="button" onClick={() => openExtra(['Tạo BM từ token'])}><Building2 size={18} /><span><strong>Tạo BM từ token</strong><small>Luồng tạo BM chính thức</small></span><ChevronRight size={15} /></button>
              <button type="button" onClick={() => openExtra(['Token'])}><KeyRound size={18} /><span><strong>Kho token</strong><small>Quản lý token mã hóa</small></span><ChevronRight size={15} /></button>
              <button type="button" onClick={() => openExtra(['Workflow'])}><Workflow size={18} /><span><strong>Workflow</strong><small>Giữ nguyên chức năng app cũ</small></span><ChevronRight size={15} /></button>
            </div>
          </section>
        </div>
        {assetTable('TKQC', 'Tài khoản quảng cáo gần đây', 'Bảng vận hành nhanh theo trạng thái tài khoản quảng cáo.')}
      </>
    );
  }

  function renderProfile() {
    return (
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>Profile đã kết nối</h2><p>Chỉ hiển thị danh tính Meta mà token hợp lệ trả về. App không lưu mật khẩu, cookie hoặc 2FA.</p></div><UserRound size={20} /></div>
        <div className={styles.cardGrid}>
          {tokens.length === 0 ? <div className={styles.empty}>Chưa có token nào trong kho.</div> : tokens.map((token) => (
            <div className={styles.profileCard} key={token.id}>
              <div className={styles.avatar}>{(token.metaUserName || token.label || 'M').slice(0, 1).toUpperCase()}</div>
              <div><strong>{token.metaUserName || token.label}</strong><small>{token.metaUserId || token.fingerprint || 'Meta user chưa xác định'}</small></div>
              <span className={`${styles.status} ${statusTone(tokenLabels[token.status])}`}>{tokenLabels[token.status]}</span>
              {token.lastError && <p>{token.lastError}</p>}
            </div>
          ))}
        </div>
      </section>
    );
  }

  function renderCampaigns() {
    const adAccounts = assets.filter((asset) => asset.type === 'TKQC');
    return (
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>Quản lý Campaign</h2><p>Đọc campaign trực tiếp bằng token bạn đã tự cấp. Luồng này chỉ đọc, không tự thay đổi ngân sách hoặc trạng thái.</p></div><Megaphone size={20} /></div>
        <div className={styles.toolbarGrid}>
          <label>Token<select value={selectedToken} onChange={(event) => setSelectedToken(event.target.value)}><option value="">Chọn token</option>{tokens.map((token) => <option value={token.id} key={token.id}>{token.label} · {tokenLabels[token.status]}</option>)}</select></label>
          <label>Tài khoản QC<select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Chọn TKQC</option>{adAccounts.map((asset) => <option value={metaId(asset)} key={asset.id}>{asset.name} · {metaId(asset)}</option>)}</select></label>
          <button className="button primary" type="button" disabled={campaignLoading || !selectedToken || !accountId} onClick={() => void loadCampaigns()}>{campaignLoading ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />} Tải campaign</button>
        </div>
        <div className={styles.tableWrap}>
          <table><thead><tr><th>Campaign</th><th>Trạng thái</th><th>Effective</th><th>Objective</th><th>Daily budget</th><th>Lifetime budget</th><th>Cập nhật</th></tr></thead><tbody>
            {campaignLoading ? <tr><td colSpan={7} className={styles.empty}>Đang đọc campaign…</td></tr> : campaigns.length === 0 ? <tr><td colSpan={7} className={styles.empty}>Chọn token + TKQC rồi bấm Tải campaign.</td></tr> : campaigns.map((campaign) => <tr key={campaign.id}><td><strong>{campaign.name}</strong><small>{campaign.id}</small></td><td><span className={`${styles.status} ${statusTone(campaign.status)}`}>{campaign.status || '—'}</span></td><td>{campaign.effectiveStatus || '—'}</td><td>{campaign.objective || '—'}</td><td>{campaign.dailyBudget || '—'}</td><td>{campaign.lifetimeBudget || '—'}</td><td>{dateText(campaign.updatedTime)}</td></tr>)}
          </tbody></table>
        </div>
      </section>
    );
  }

  function renderBmCheck() {
    const rows = filteredAssets('BM');
    return (
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>Check BM</h2><p>Trạng thái truy cập, xác minh doanh nghiệp và thông tin Page đại diện.</p></div><button className="button primary" type="button" disabled={busy} onClick={() => void healthCheck('BM')}><HeartPulse size={16} /> Kiểm tra</button></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Business Manager</th><th>Truy cập</th><th>Xác minh</th><th>Primary Page</th><th>Timezone</th><th>Ngày tạo</th><th>Kiểm tra</th></tr></thead><tbody>
          {rows.length === 0 ? <tr><td colSpan={7} className={styles.empty}>Chưa có BM. Hãy đồng bộ bằng token.</td></tr> : rows.map((asset) => <tr key={asset.id}><td><strong>{asset.name}</strong><small>{metaId(asset)}</small></td><td><span className={`${styles.status} ${statusTone(asset.status)}`}>{asset.status}</span></td><td><span className={`${styles.status} ${asset.verified ? styles.good : styles.neutral}`}>{asset.verified ? 'Đã xác minh' : asset.verificationStatus || 'Chưa xác minh'}</span></td><td>{asset.primaryPageName || asset.primaryPageId || '—'}</td><td>{asset.timezoneId || '—'}</td><td>{dateText(asset.creationTime)}</td><td>{dateText(asset.checked)}</td></tr>)}
        </tbody></table></div>
      </section>
    );
  }

  function renderBmSync() {
    return (
      <section className={styles.panel}>
        <div className={styles.syncHero}>
          <RefreshCw size={34} />
          <div><h2>Đồng bộ BM và tài nguyên</h2><p>Dùng token đã lưu để nhập BM, TKQC, Page và Pixel mà Meta cho phép token truy cập. Không dùng cookie trình duyệt.</p></div>
        </div>
        <div className={styles.toolbarGrid}>
          <label>Token nguồn<select value={selectedToken} onChange={(event) => setSelectedToken(event.target.value)}><option value="">Chọn token</option>{tokens.map((token) => <option key={token.id} value={token.id}>{token.label} · {tokenLabels[token.status]}</option>)}</select></label>
          <div className={styles.tokenSummary}><strong>{selectedTokenRecord?.metaUserName || 'Chưa chọn token'}</strong><small>{selectedTokenRecord ? tokenLabels[selectedTokenRecord.status] : 'Chọn một token hợp lệ để đồng bộ'}</small></div>
          <button className="button primary" type="button" disabled={busy || !selectedToken} onClick={() => void importFromToken()}>{busy ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />} Đồng bộ ngay</button>
        </div>
      </section>
    );
  }

  function renderUidTool() {
    function resolveUid() {
      const value = uidInput.trim();
      const direct = value.match(/^\d{5,30}$/)?.[0];
      const fromUrl = value.match(/(?:id=|profile\.php\?id=|\/)(\d{5,30})(?:[/?#]|$)/)?.[1];
      setUidResult(direct || fromUrl || '');
      if (!direct && !fromUrl) setToast('Không thấy UID số trong dữ liệu đã nhập. Tool này không vượt qua quyền riêng tư để suy ra UID ẩn.');
    }
    return (
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>Tra cứu UID</h2><p>Trích UID số đã có sẵn trong đường dẫn hoặc chuỗi đầu vào. Không dùng scraping để suy ra UID ẩn.</p></div><Search size={20} /></div>
        <div className={styles.uidTool}><input value={uidInput} onChange={(event) => setUidInput(event.target.value)} placeholder="Dán UID hoặc URL Facebook có chứa ID số" /><button className="button primary" type="button" onClick={resolveUid}><Search size={16} /> Tra cứu</button></div>
        {uidResult && <div className={styles.resultBox}><span>UID</span><strong>{uidResult}</strong><button className="button" type="button" onClick={() => void navigator.clipboard.writeText(uidResult)}><Copy size={15} /> Sao chép</button></div>}
      </section>
    );
  }

  function renderTextTool() {
    function transform(mode: 'clean' | 'dedupe' | 'sort' | 'reverse') {
      let lines = textInput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (mode === 'dedupe') lines = Array.from(new Set(lines));
      if (mode === 'sort') lines = [...lines].sort((a, b) => a.localeCompare(b, 'vi'));
      if (mode === 'reverse') lines = [...lines].reverse();
      setTextOutput(lines.join('\n'));
    }
    return (
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>Xử lý Text</h2><p>Cắt khoảng trắng, lọc trùng, sắp xếp và đảo danh sách ngay trên trình duyệt.</p></div><WandSparkles size={20} /></div>
        <div className={styles.textGrid}>
          <textarea rows={15} value={textInput} onChange={(event) => setTextInput(event.target.value)} placeholder="Mỗi dòng một giá trị…" />
          <textarea rows={15} value={textOutput} onChange={(event) => setTextOutput(event.target.value)} placeholder="Kết quả…" />
        </div>
        <div className={styles.actions}><button className="button" type="button" onClick={() => transform('clean')}>Làm sạch</button><button className="button" type="button" onClick={() => transform('dedupe')}>Lọc trùng</button><button className="button" type="button" onClick={() => transform('sort')}>Sắp xếp</button><button className="button" type="button" onClick={() => transform('reverse')}>Đảo thứ tự</button><button className="button primary" type="button" disabled={!textOutput} onClick={() => void navigator.clipboard.writeText(textOutput)}><Copy size={15} /> Copy kết quả</button></div>
      </section>
    );
  }

  function renderLogs() {
    return (
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>Nhật ký hoạt động</h2><p>Các thao tác đã được ghi vào workspace.</p></div><History size={20} /></div>
        <div className={styles.logList}>{logs.length === 0 ? <div className={styles.empty}>Chưa có nhật ký.</div> : logs.slice(0, 100).map((log) => <div key={log.id}><span className={styles.logIcon}><Activity size={15} /></span><div><strong>{String(log.name || '')}</strong><small>{dateText(String(log.created || ''))}</small></div><span className={`${styles.status} ${statusTone(String(log.status || ''))}`}>{String(log.status || 'Đã ghi')}</span></div>)}</div>
      </section>
    );
  }

  function renderSettings() {
    return (
      <div className={styles.settingsGrid}>
        <section className={styles.panel}><div className={styles.panelHeader}><div><h2>Kết nối Meta</h2><p>Chọn token cho các công cụ trong dashboard.</p></div><KeyRound size={20} /></div><label className={styles.field}>Token mặc định<select value={selectedToken} onChange={(event) => setSelectedToken(event.target.value)}><option value="">Chọn token</option>{tokens.map((token) => <option key={token.id} value={token.id}>{token.label} · {tokenLabels[token.status]}</option>)}</select></label><button className="button primary" type="button" onClick={() => openExtra(['Token'])}><KeyRound size={16} /> Mở quản lý token</button></section>
        <section className={styles.panel}><div className={styles.panelHeader}><div><h2>Giao diện</h2><p>Giữ màu tím chủ đạo của app; bạn có thể đổi chế độ sáng/tối.</p></div><Monitor size={20} /></div><div className={styles.themeButtons}><button className={theme === 'system' ? styles.selectedTheme : ''} onClick={() => setTheme('system')}><Monitor size={17} /> Hệ thống</button><button className={theme === 'light' ? styles.selectedTheme : ''} onClick={() => setTheme('light')}><Sun size={17} /> Sáng</button><button className={theme === 'dark' ? styles.selectedTheme : ''} onClick={() => setTheme('dark')}><Moon size={17} /> Tối</button></div></section>
      </div>
    );
  }

  function renderView() {
    switch (view) {
      case 'home': return renderHome();
      case 'profile': return renderProfile();
      case 'ads': return assetTable('TKQC', 'Quản lý tài khoản quảng cáo', 'Theo dõi trạng thái, BM sở hữu, hạn mức nhãn và lần kiểm tra gần nhất.');
      case 'pixels': return assetTable('Dataset/Pixel', 'Quản lý Pixel / Dataset', 'Danh sách Pixel và Dataset đã nhập từ token hoặc workspace.');
      case 'campaigns': return renderCampaigns();
      case 'bm': return assetTable('BM', 'Quản lý Business Manager', 'Tập trung BM, trạng thái truy cập và thông tin xác minh.');
      case 'bm-check': return renderBmCheck();
      case 'bm-sync': return renderBmSync();
      case 'bm-links': return unavailable('Quản lý link BM', 'Màn hình đã được đưa vào đúng nhóm BM. App hiện chưa tự tạo link mời hoặc link chuyển quyền.', ['Có thể lưu/hiển thị link BM hợp lệ ở bản tiếp theo', 'Không sinh link bằng endpoint nội bộ hoặc cookie', 'Giữ luồng Tạo BM từ token ở menu trên']);
      case 'pages': return assetTable('Page', 'Quản lý Fanpage', 'Fanpage mà token/workspace đang truy cập được.');
      case 'page-messages': return unavailable('Quản lý tin nhắn Page', 'Tính năng cần Page Access Token và quyền pages_messaging hợp lệ. Mình giữ mục này trong giao diện nhưng không giả lập quyền nhắn tin.', ['Không lưu cookie đăng nhập', 'Chỉ hỗ trợ Page được Meta cấp quyền', 'Có thể nối API inbox khi Page token sẵn sàng']);
      case 'page-uid': return unavailable('Quét UID tương tác', 'Mục được giữ đúng nhóm Page nhưng không tự động quét người dùng ngoài phạm vi API được Meta cấp.', ['Không scrape danh tính người dùng', 'Không vượt quyền riêng tư', 'Có thể đọc dữ liệu aggregate/được ủy quyền qua Graph API']);
      case 'profile-posts': return unavailable('Quản lý bài viết Profile', 'Meta không còn hỗ trợ publish_actions cho profile cá nhân. App chỉ hỗ trợ thao tác được API hiện hành cho phép.', ['Không đăng bài profile bằng session/cookie', 'Không lưu thông tin đăng nhập', 'Page posting vẫn có thể nối bằng Page token']);
      case 'profile-friends': return unavailable('Quản lý bạn bè', 'Mục được giữ để đồng bộ bố cục, nhưng app không tự gửi lời mời/kết bạn hoặc thu thập danh sách bạn bè bằng cookie.', ['Không tự động add friend', 'Không đọc danh sách riêng tư', 'Chỉ dùng dữ liệu OAuth được cấp']);
      case 'profile-optimize': return unavailable('Tối ưu Facebook', 'Chỉ cung cấp lớp kiểm tra an toàn và quyền; không tự thay đổi cài đặt tài khoản cá nhân.', ['Kiểm tra token', 'Kiểm tra tài nguyên', 'Không can thiệp bảo mật tài khoản']);
      case 'content-groups': return unavailable('Đăng bài nhóm', 'Tự động đăng hàng loạt vào Group có thể tạo spam và thường không có API chính thức phù hợp, nên app không tự động hóa bằng cookie.', ['Giữ mục điều hướng', 'Không dùng session trình duyệt', 'Có thể nối API được Meta phê duyệt nếu có']);
      case 'content-pages': return unavailable('Đăng bài trang', 'Page posting có thể triển khai khi Page Access Token và pages_manage_posts hợp lệ được kết nối.', ['Dùng API chính thức', 'Không dùng cookie', 'Có thể thêm hàng đợi nội dung sau']);
      case 'content-manage': return unavailable('Quản lý bài đăng', 'Khung quản lý đã có trong điều hướng; dữ liệu bài Page/Group sẽ chỉ hiển thị khi API hợp lệ được nối.', ['Không scrape nội dung riêng tư', 'Không tự động xóa bài', 'Có thể đọc Page posts được ủy quyền']);
      case 'content-library': return unavailable('Thư viện nội dung', 'Có thể dùng Bí kíp và workspace hiện tại làm nền cho kho nội dung; mục này được giữ riêng theo bố cục mới.', ['Giữ tài nguyên cũ', 'Không xóa dữ liệu hiện tại', 'Bí kíp vẫn ở menu trên']);
      case 'content-reply': return unavailable('Trả lời tự động', 'Chỉ nên chạy trên Page đã ủy quyền với pages_manage_engagement/pages_messaging.', ['Không auto-reply trên tài khoản cá nhân', 'Không vượt quyền Page', 'Có thể thêm rule sau khi Page token sẵn sàng']);
      case 'groups':
      case 'group-user-scan':
      case 'group-member-scan':
      case 'group-find': return unavailable(activeItem?.label || 'Group', 'Nhóm tính năng Group được đưa vào giao diện nhưng không dùng cookie để quét thành viên, dò người dùng hoặc tự động tham gia nhóm.', ['Không thu thập dữ liệu thành viên ngoài API', 'Không tự động join nhóm', 'Giữ cấu trúc menu như công cụ tham chiếu']);
      case 'temp-mail': return unavailable('Email tạm thời', 'Mục tiện ích đã được thêm vào UI. App chưa kết nối nhà cung cấp hộp thư tạm thời hoặc luồng lấy OTP.', ['Không thu thập OTP', 'Không tự đăng ký tài khoản', 'Có thể tích hợp nhà cung cấp hợp pháp riêng nếu bạn có API']);
      case 'uid': return renderUidTool();
      case 'video': return unavailable('Video Downloader', 'Mục được giữ theo nhóm tiện ích, nhưng app không tự tải nội dung từ nền tảng bên thứ ba khi chưa xác định quyền sử dụng nội dung.', ['Không bypass DRM', 'Không tải nội dung riêng tư', 'Có thể hỗ trợ file/URL bạn có quyền sử dụng']);
      case 'text': return renderTextTool();
      case 'logs': return renderLogs();
      case 'settings': return renderSettings();
      default: return renderHome();
    }
  }

  return (
    <div className={`${styles.shell} ${theme === 'dark' ? styles.dark : ''}`}>
      <aside className={`sidebar ${styles.sidebar} ${mobileMenu ? styles.sidebarOpen : ''}`}>
        <div className={styles.brandRow}>
          <a className={styles.brand} href="/" aria-label="Ads Workspace"><span className={styles.brandIcon}><Boxes size={20} /></span><span>ADS WORKSPACE<small>Meta operations</small></span></a>
          <button className={styles.closeMobile} type="button" onClick={() => setMobileMenu(false)} aria-label="Đóng menu"><X size={19} /></button>
        </div>
        <div className={styles.qualityMini}><span>Chất lượng tài khoản</span><strong>{assets.length ? Math.max(0, Math.round((counts.live / Math.max(assets.length, 1)) * 100)) : 100}%</strong><div><i style={{ width: `${assets.length ? Math.max(0, Math.round((counts.live / Math.max(assets.length, 1)) * 100)) : 100}%` }} /></div></div>

        <nav className={styles.portalNav} aria-hidden="true" />

        <div className={styles.navScroll}>
          {sections.map((section) => (
            <div className={styles.navSection} key={section.label}>
              <div className={styles.navLabel}>{section.label}</div>
              {section.items.map((item) => {
                const Icon = item.icon;
                return <button className={`nav-item ${styles.navButton} ${view === item.key ? styles.active : ''}`} type="button" key={item.key} onClick={() => selectView(item.key)}><Icon size={17} /><span>{item.label}</span>{item.key === 'ads' && counts.ads > 0 && <small>{counts.ads}</small>}{item.key === 'bm' && counts.bm > 0 && <small>{counts.bm}</small>}</button>;
              })}
            </div>
          ))}
        </div>

        <div className={styles.sidebarFooter}>
          <div className={styles.themeInline}><button className={theme === 'system' ? styles.themeActive : ''} onClick={() => setTheme('system')} title="Hệ thống"><Monitor size={15} /></button><button className={theme === 'light' ? styles.themeActive : ''} onClick={() => setTheme('light')} title="Sáng"><Sun size={15} /></button><button className={theme === 'dark' ? styles.themeActive : ''} onClick={() => setTheme('dark')} title="Tối"><Moon size={15} /></button></div>
          <div className={styles.userBox}><span className={styles.avatar}>N</span><span><strong>Nguyễn Workspace</strong><small>{selectedTokenRecord?.metaUserName || 'Workspace cá nhân'}</small></span></div>
        </div>
      </aside>

      {mobileMenu && <button className={styles.scrim} type="button" onClick={() => setMobileMenu(false)} aria-label="Đóng menu" />}

      <div className={`main-wrap ${styles.mainWrap}`}>
        <header className={styles.topbar}>
          <div className="breadcrumb"><button className={styles.mobileButton} type="button" onClick={() => setMobileMenu(true)} aria-label="Mở menu"><Menu size={19} /></button><span>Workspace</span><ChevronRight size={13} /><strong>{activeItem?.label || 'Trang chủ'}</strong></div>
          <div className={styles.extraMenu}>
            {extraTools.map((tool) => <button key={tool.label} type="button" onClick={() => openExtra(tool.matches)}>{tool.label}</button>)}
          </div>
          <div className={styles.topRight}>
            <label className={styles.globalSearch}><Search size={15} /><input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="Tìm tài nguyên…" /></label>
            <button className={styles.iconButton} type="button" onClick={() => selectView('logs')} aria-label="Nhật ký"><History size={18} /></button>
            <span className={styles.topAvatar}>N</span>
          </div>
        </header>

        <main className={styles.main}>
          {toast && <div className={styles.toast}><CheckCircle2 size={16} />{toast}</div>}
          {error && <div className={styles.error}><AlertTriangle size={16} />{error}</div>}
          {renderView()}
          <footer className={styles.footer}><span>ADS WORKSPACE</span><span>UI mới lấy cảm hứng từ cách nhóm tính năng của EZTOOL, nhưng giữ thương hiệu và màu chủ đạo của app.</span><span>{connected ? 'Meta server token đã cấu hình' : `${tokens.length} token người dùng`}</span></footer>
        </main>
      </div>
    </div>
  );
}
