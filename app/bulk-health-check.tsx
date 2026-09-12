'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, HeartPulse, LoaderCircle, Search, X } from 'lucide-react';

type Resource = {
  key: string;
  id: string;
  metaId?: string;
  name: string;
  type: string;
  health: 'LIVE' | 'DIE' | 'RESTRICTED' | 'UNKNOWN' | 'N/A';
  lifecycle: string;
  sourceToken?: string;
};

type Token = {
  id: string;
  label: string;
  status: string;
  metaUserName?: string;
};

type HealthResult = {
  id: string;
  health: string;
  message: string;
  tokenLabel?: string;
};

type HealthResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  results?: HealthResult[];
  summary?: { total: number; live: number; die: number; restricted: number; unknown: number; skipped: number };
};

export default function BulkHealthCheck() {
  const [target, setTarget] = useState<Element | null>(null);
  const [open, setOpen] = useState(false);
  const [resources, setResources] = useState<Resource[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('ALL');
  const [health, setHealth] = useState('ALL');
  const [tokenId, setTokenId] = useState('');
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [results, setResults] = useState<HealthResult[]>([]);

  const findTarget = useCallback(() => {
    setTarget(document.querySelector('.resource-center-main .heading-actions'));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(findTarget, 0);
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [findTarget]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [resourceResponse, tokenResponse] = await Promise.all([
        fetch('/api/resource-center', { cache: 'no-store' }),
        fetch('/api/meta-tokens', { cache: 'no-store' }),
      ]);
      const resourceData = await resourceResponse.json() as { resources?: Resource[]; error?: string };
      const tokenData = await tokenResponse.json() as { tokens?: Token[]; error?: string };
      if (!resourceResponse.ok) throw new Error(resourceData.error || 'Không tải được tài nguyên.');
      if (!tokenResponse.ok) throw new Error(tokenData.error || 'Không tải được token.');
      setResources((resourceData.resources || []).filter((resource) => resource.type !== 'Bí kíp' && resource.health !== 'N/A'));
      setTokens(tokenData.tokens || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setResults([]);
    setMessage('');
    setError('');
    setQuery('');
    setType('ALL');
    setHealth('ALL');
    setTokenId('');
    void load();
  }, [open, load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return resources.filter((resource) => {
      if (type !== 'ALL' && resource.type !== type) return false;
      if (health !== 'ALL' && resource.health !== health) return false;
      if (!needle) return true;
      return `${resource.name} ${resource.metaId || resource.id} ${resource.sourceToken || ''}`.toLowerCase().includes(needle);
    });
  }, [resources, query, type, health]);

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length >= 100 ? current : [...current, id]);
  }

  function selectFiltered() {
    const ids = filtered.slice(0, 100).map((resource) => resource.id);
    setSelected(ids);
    if (filtered.length > 100) setMessage('Đã chọn 100 tài nguyên đầu tiên. Mỗi lượt Health Check tối đa 100 tài nguyên.');
  }

  async function run() {
    if (!selected.length) return;
    setRunning(true);
    setError('');
    setMessage('');
    setResults([]);
    try {
      const response = await fetch('/api/resource-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selected, tokenId }),
      });
      const data = await response.json() as HealthResponse;
      if (!response.ok) throw new Error(data.error || 'Health Check thất bại.');
      setResults(data.results || []);
      const summary = data.summary;
      setMessage(summary
        ? `Đã kiểm tra ${summary.total}: LIVE ${summary.live}, DIE ${summary.die}, hạn chế ${summary.restricted}, chưa xác định ${summary.unknown}, bỏ qua ${summary.skipped}.`
        : data.message || 'Đã hoàn tất Health Check.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const button = target ? createPortal(
    <button className="button primary" type="button" onClick={() => setOpen(true)}>
      <HeartPulse size={17} /> Health Check hàng loạt
    </button>,
    target,
  ) : null;

  const modal = open ? createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(17,24,39,.48)', display: 'grid', placeItems: 'center', padding: 22 }} onMouseDown={(event) => { if (event.target === event.currentTarget && !running) setOpen(false); }}>
      <div className="panel" style={{ width: 'min(1120px,96vw)', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #eceef3' }}>
          <div>
            <div className="eyebrow">META GRAPH API</div>
            <h2 style={{ margin: '4px 0 5px' }}>Health Check hàng loạt</h2>
            <p className="muted" style={{ margin: 0 }}>Kiểm tra tối đa 100 tài nguyên/lượt. Không tự đổi token và không retry khi token lỗi hoặc rate limit.</p>
          </div>
          <button className="icon-button" type="button" disabled={running} onClick={() => setOpen(false)} aria-label="Đóng"><X size={20} /></button>
        </div>

        <div style={{ padding: 18, display: 'grid', gridTemplateColumns: 'minmax(260px,1fr) repeat(3,minmax(150px,190px))', gap: 10, borderBottom: '1px solid #eceef3' }}>
          <label style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: 12, color: '#8d93a1' }} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên, Meta ID hoặc token nguồn..." style={{ width: '100%', paddingLeft: 36 }} />
          </label>
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="ALL">Tất cả loại</option>
            <option value="BM">Business Manager</option>
            <option value="TKQC">Tài khoản quảng cáo</option>
            <option value="Page">Page</option>
            <option value="Dataset/Pixel">Dataset / Pixel</option>
          </select>
          <select value={health} onChange={(event) => setHealth(event.target.value)}>
            <option value="ALL">Tất cả trạng thái</option>
            <option value="LIVE">LIVE</option>
            <option value="DIE">DIE</option>
            <option value="RESTRICTED">Hạn chế</option>
            <option value="UNKNOWN">Chưa xác định</option>
          </select>
          <select value={tokenId} onChange={(event) => setTokenId(event.target.value)}>
            <option value="">Dùng token nguồn của tài nguyên</option>
            {tokens.map((token) => <option value={token.id} key={token.id}>{token.label} · {token.status}</option>)}
          </select>
        </div>

        <div style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid #eceef3' }}>
          <button className="button" type="button" disabled={!filtered.length || running} onClick={selectFiltered}>Chọn tất cả đang lọc</button>
          <button className="button" type="button" disabled={!selected.length || running} onClick={() => setSelected([])}>Bỏ chọn</button>
          <strong style={{ marginLeft: 'auto' }}>Đã chọn {selected.length}/100</strong>
        </div>

        <div style={{ overflow: 'auto', minHeight: 260, maxHeight: '48vh' }}>
          <table>
            <thead><tr><th></th><th>Tài nguyên</th><th>Loại</th><th>Hiện tại</th><th>Token nguồn</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={5} style={{ padding: 30, textAlign: 'center' }}>Đang tải…</td></tr> : filtered.length === 0 ? <tr><td colSpan={5} style={{ padding: 30, textAlign: 'center' }} className="muted">Không có tài nguyên phù hợp.</td></tr> : filtered.map((resource) => (
                <tr key={resource.id}>
                  <td><input type="checkbox" checked={selected.includes(resource.id)} onChange={() => toggle(resource.id)} /></td>
                  <td><strong>{resource.name}</strong><small className="muted" style={{ display: 'block' }}>{resource.metaId || resource.id}</small></td>
                  <td>{resource.type}</td>
                  <td>{resource.health}</td>
                  <td>{resource.sourceToken || 'Chưa xác định'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(message || error || results.length > 0) && <div style={{ padding: '12px 18px', borderTop: '1px solid #eceef3', maxHeight: 150, overflow: 'auto' }}>
          {message && <div style={{ color: '#176b37', display: 'flex', gap: 7, alignItems: 'center' }}><CheckCircle2 size={16} />{message}</div>}
          {error && <div style={{ color: '#a13a35' }}>{error}</div>}
          {results.filter((item) => item.health !== 'LIVE').slice(0, 12).map((item) => <small key={item.id} style={{ display: 'block', marginTop: 5, color: item.health === 'DIE' ? '#a13a35' : '#755400' }}>{item.health} · {item.message}</small>)}
        </div>}

        <div style={{ padding: '14px 18px', borderTop: '1px solid #eceef3', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="button" type="button" disabled={running} onClick={() => setOpen(false)}>Đóng</button>
          <button className="button primary" type="button" disabled={!selected.length || running} onClick={() => void run()}>
            {running ? <LoaderCircle size={16} className="spin" /> : <HeartPulse size={16} />}
            {running ? 'Đang kiểm tra…' : `Kiểm tra ${selected.length} tài nguyên`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return <>{button}{modal}</>;
}
