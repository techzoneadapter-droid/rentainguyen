'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
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
  fingerprint: string;
  status: TokenStatus;
  metaUserId?: string;
  metaUserName?: string;
  lastCheckedAt?: string;
  lastCreateAt?: string;
  lastCreateResult?: string;
  lastError?: string;
};

type ApiResponse = {
  tokens?: TokenItem[];
  message?: string;
  error?: string;
  token?: TokenItem;
};

const statusInfo: Record<TokenStatus, { label: string; bg: string; color: string }> = {
  active: { label: 'Hoạt động', bg: '#eaf8ef', color: '#176b37' },
  invalid: { label: 'Hết hạn / không hợp lệ', bg: '#fff0ef', color: '#a13a35' },
  permission_issue: { label: 'Thiếu quyền', bg: '#fff7e5', color: '#8a5d00' },
  rate_limited: { label: 'Rate limit', bg: '#fff7e5', color: '#8a5d00' },
  create_restricted: { label: 'Bị giới hạn tạo BM', bg: '#fff0ef', color: '#a13a35' },
  unknown_error: { label: 'Cần kiểm tra', bg: '#f1f2f5', color: '#555b66' },
};

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('vi-VN') : 'Chưa có';
}

export default function TokenWorkspaceSection() {
  const [navTarget, setNavTarget] = useState<Element | null>(null);
  const [mainTarget, setMainTarget] = useState<Element | null>(null);
  const [active, setActive] = useState(false);
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const findTargets = useCallback(() => {
    const navs = document.querySelectorAll('.sidebar nav');
    setNavTarget(navs.length > 1 ? navs[1] : navs[0] || null);
    setMainTarget(document.querySelector('.main-wrap'));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/meta-tokens', { cache: 'no-store' });
      const data = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(data.error || 'Không tải được danh sách token.');
      setTokens(data.tokens || []);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    findTargets();
    const observer = new MutationObserver(findTargets);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [findTargets]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!active) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const navButton = target.closest('.nav-item');
      if (navButton && !navButton.hasAttribute('data-token-manager-nav')) setActive(false);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [active]);

  useEffect(() => {
    const originalMain = document.querySelector('.main-wrap > main:not(.token-workspace-main)') as HTMLElement | null;
    const breadcrumb = document.querySelector('.breadcrumb strong') as HTMLElement | null;
    if (!active) return;

    const oldDisplay = originalMain?.style.display || '';
    const oldBreadcrumb = breadcrumb?.textContent || '';
    if (originalMain) originalMain.style.display = 'none';
    if (breadcrumb) breadcrumb.textContent = 'Quản lý token';
    void load();

    return () => {
      if (originalMain) originalMain.style.display = oldDisplay;
      if (breadcrumb) breadcrumb.textContent = oldBreadcrumb;
    };
  }, [active, load]);

  const counts = useMemo(
    () => ({
      total: tokens.length,
      active: tokens.filter((token) => token.status === 'active').length,
      attention: tokens.filter((token) => token.status !== 'active').length,
    }),
    [tokens],
  );

  async function addToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdding(true);
    setError('');
    setMessage('');
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch('/api/meta-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          label: String(data.get('label') || ''),
          token: String(data.get('token') || ''),
        }),
      });
      const result = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(result.error || 'Không lưu được token.');
      form.reset();
      setMessage(result.message || 'Đã lưu token.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function tokenAction(action: 'check' | 'delete', id: string) {
    if (action === 'delete' && !window.confirm('Xóa token này khỏi kho? Hành động này không ảnh hưởng tài khoản Meta.')) return;
    setBusyId(id);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/meta-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id }),
      });
      const result = (await response.json()) as ApiResponse;
      if (!response.ok && !result.token) throw new Error(result.error || 'Không cập nhật được token.');
      setMessage(result.message || 'Đã cập nhật trạng thái token.');
      if (result.error) setError(result.error);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId('');
    }
  }

  const navPortal = navTarget
    ? createPortal(
        <button
          type="button"
          data-token-manager-nav
          className={`nav-item ${active ? 'active' : ''}`}
          onClick={() => setActive(true)}
        >
          <KeyRound size={19} />
          <span>Quản lý token</span>
          {tokens.length > 0 && <small>{tokens.length}</small>}
        </button>,
        navTarget,
      )
    : null;

  const panelPortal = active && mainTarget
    ? createPortal(
        <main className="token-workspace-main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">META ACCESS MANAGEMENT</div>
              <h1>Quản lý token</h1>
              <p>Lưu token nguồn hợp lệ, kiểm tra trạng thái và chọn thủ công khi tạo Business Manager.</p>
            </div>
            <div className="heading-actions">
              <button className="button" type="button" disabled={loading} onClick={() => void load()}>
                <RefreshCw size={16} className={loading ? 'spin' : ''} /> Làm mới
              </button>
            </div>
          </div>

          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 16, marginBottom: 22 }}>
            {[
              ['Tổng token', counts.total],
              ['Đang hoạt động', counts.active],
              ['Cần chú ý', counts.attention],
            ].map(([label, value]) => (
              <div className="panel" key={String(label)} style={{ padding: 18 }}>
                <small className="muted">{label}</small>
                <strong style={{ display: 'block', fontSize: 30, marginTop: 7 }}>{value}</strong>
              </div>
            ))}
          </section>

          <section className="panel" style={{ padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 15 }}>
              <span className="stat-icon tone-0"><KeyRound size={18} /></span>
              <div>
                <h2>Thêm token nguồn</h2>
                <small className="muted">Token được mã hóa trước khi lưu và không được trả lại cho trình duyệt.</small>
              </div>
            </div>
            <form onSubmit={addToken} style={{ display: 'grid', gridTemplateColumns: '220px minmax(280px,1fr) auto', gap: 10 }}>
              <input name="label" required maxLength={80} placeholder="Tên gợi nhớ, VD: Acc công ty A" />
              <input name="token" type="password" required minLength={20} maxLength={4096} autoComplete="off" placeholder="Dán access token tại đây" />
              <button className="button primary" disabled={adding}>
                {adding ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}
                {adding ? 'Đang kiểm tra…' : 'Kiểm tra & lưu'}
              </button>
            </form>
            <p className="muted" style={{ fontSize: 11, lineHeight: 1.6, marginTop: 11 }}>
              App không tự chuyển token khi Meta giới hạn một tài khoản. Bạn chủ động chọn token nguồn trong trình tạo BM.
            </p>
          </section>

          {message && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 11, marginBottom: 12, borderRadius: 8, background: '#eaf8ef', color: '#176b37' }}>
              <CheckCircle2 size={17} /> {message}
            </div>
          )}
          {error && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 11, marginBottom: 12, borderRadius: 8, background: '#fff0ef', color: '#9c3531' }}>
              <ShieldAlert size={17} style={{ marginTop: 2 }} /> {error}
            </div>
          )}

          <section className="panel" style={{ marginBottom: 30 }}>
            <div className="panel-heading"><h2>Danh sách token</h2></div>
            {loading && !tokens.length ? (
              <div style={{ padding: 28, textAlign: 'center' }} className="muted">Đang tải…</div>
            ) : tokens.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center' }} className="muted">Chưa có token nguồn.</div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>Nguồn token</th><th>Trạng thái</th><th>Lần kiểm tra</th><th>Lần dùng tạo BM</th><th>Kết quả gần nhất</th><th>Thao tác</th></tr>
                  </thead>
                  <tbody>
                    {tokens.map((token) => {
                      const info = statusInfo[token.status];
                      return (
                        <tr key={token.id}>
                          <td>
                            <strong style={{ display: 'block', color: '#505464' }}>{token.label}</strong>
                            <small className="muted">{token.metaUserName || 'Chưa nhận diện user'} {token.metaUserId ? `· ${token.metaUserId}` : ''}</small>
                            <small style={{ display: 'block', color: '#a2a4ae', fontFamily: 'ui-monospace,monospace' }}>FP {token.fingerprint}</small>
                          </td>
                          <td><span style={{ display: 'inline-block', padding: '5px 8px', borderRadius: 999, background: info.bg, color: info.color, fontWeight: 600 }}>{info.label}</span></td>
                          <td>{formatDate(token.lastCheckedAt)}</td>
                          <td>{formatDate(token.lastCreateAt)}</td>
                          <td style={{ maxWidth: 330, whiteSpace: 'normal' }}>
                            {token.lastCreateResult || token.lastError || 'Chưa có'}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 7 }}>
                              <button className="icon-button" type="button" disabled={busyId === token.id} onClick={() => void tokenAction('check', token.id)} title="Kiểm tra lại token">
                                {busyId === token.id ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
                              </button>
                              <button className="icon-button" type="button" disabled={busyId === token.id} onClick={() => void tokenAction('delete', token.id)} title="Xóa token" style={{ color: '#b34d55' }}>
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </main>,
        mainTarget,
      )
    : null;

  return <>{navPortal}{panelPortal}</>;
}
