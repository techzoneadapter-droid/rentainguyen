'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2, KeyRound, LoaderCircle, Plus, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';

type TokenStatus = 'active' | 'invalid' | 'permission_issue' | 'rate_limited' | 'create_restricted' | 'unknown_error';

type TokenItem = {
  id: string;
  label: string;
  fingerprint: string;
  status: TokenStatus;
  created: string;
  updated: string;
  metaUserId?: string;
  metaUserName?: string;
  lastCheckedAt?: string;
  lastUsedAt?: string;
  lastCreateAt?: string;
  lastCreateResult?: string;
  lastError?: string;
  lastErrorCode?: number;
  lastErrorSubcode?: number;
};

type ApiResponse = {
  tokens?: TokenItem[];
  token?: TokenItem;
  message?: string;
  error?: string;
  tokenStatus?: TokenStatus;
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
  if (!value) return 'Chưa có';
  return new Date(value).toLocaleString('vi-VN');
}

export default function TokenManager() {
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
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
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const counts = useMemo(() => ({
    total: tokens.length,
    active: tokens.filter((token) => token.status === 'active').length,
    attention: tokens.filter((token) => token.status !== 'active').length,
  }), [tokens]);

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
      setMessage(result.message || (result.error ? 'Đã cập nhật trạng thái token theo phản hồi Meta.' : 'Đã cập nhật.'));
      if (result.error) setError(result.error);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId('');
    }
  }

  return (
    <main style={{ minHeight: '100vh', background: '#f7f8fb', color: '#1d2230', padding: '28px 18px 60px' }}>
      <div style={{ width: 'min(1120px, 100%)', margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', marginBottom: 22 }}>
          <div>
            <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#6d4bd8', textDecoration: 'none', fontSize: 13, marginBottom: 8 }}><ArrowLeft size={15} /> Về Ads Workspace</Link>
            <h1 style={{ margin: 0, fontSize: 30 }}>Token nguồn Meta</h1>
            <p style={{ margin: '7px 0 0', color: '#6d7280', lineHeight: 1.55 }}>Lưu token đã được bạn cấp hợp lệ, theo dõi trạng thái và chọn thủ công token khi tạo Business Manager.</p>
          </div>
          <button type="button" onClick={() => void load()} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid #d9dce5', background: 'white', borderRadius: 10, padding: '10px 12px', cursor: 'pointer' }}><RefreshCw size={16} /> Làm mới</button>
        </header>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12, marginBottom: 18 }}>
          {[['Tổng token', counts.total], ['Đang hoạt động', counts.active], ['Cần chú ý', counts.attention]].map(([label, value]) => (
            <div key={String(label)} style={{ background: 'white', border: '1px solid #e3e5ec', borderRadius: 14, padding: 16 }}>
              <small style={{ color: '#747986' }}>{label}</small><strong style={{ display: 'block', marginTop: 4, fontSize: 25 }}>{value}</strong>
            </div>
          ))}
        </section>

        <section style={{ background: 'white', border: '1px solid #e3e5ec', borderRadius: 16, padding: 18, marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}><KeyRound size={20} color="#6d4bd8" /><div><strong>Thêm token nguồn</strong><small style={{ display: 'block', color: '#747986', marginTop: 2 }}>Token được mã hóa AES-GCM trước khi lưu; API không bao giờ trả lại giá trị token cho trình duyệt.</small></div></div>
          <form onSubmit={addToken} style={{ display: 'grid', gridTemplateColumns: '220px 1fr auto', gap: 10 }}>
            <input name="label" required maxLength={80} placeholder="Tên gợi nhớ, VD: Acc công ty A" style={{ border: '1px solid #d9dce5', borderRadius: 10, padding: '11px 12px', minWidth: 0 }} />
            <input name="token" type="password" required minLength={20} maxLength={4096} autoComplete="off" placeholder="Dán access token tại đây" style={{ border: '1px solid #d9dce5', borderRadius: 10, padding: '11px 12px', minWidth: 0, fontFamily: 'monospace' }} />
            <button disabled={adding} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, border: 0, borderRadius: 10, background: '#7353e8', color: 'white', padding: '11px 14px', fontWeight: 700, cursor: adding ? 'not-allowed' : 'pointer', opacity: adding ? .6 : 1 }}>{adding ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}{adding ? 'Đang kiểm tra…' : 'Kiểm tra & lưu'}</button>
          </form>
          <p style={{ margin: '10px 0 0', fontSize: 12, color: '#777c88', lineHeight: 1.5 }}>App chỉ kiểm tra token khi bạn yêu cầu hoặc khi chính token đó được chọn để tạo BM. App không tự chuyển sang token khác nếu Meta giới hạn một tài khoản.</p>
        </section>

        {message && <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#eaf8ef', color: '#176b37', borderRadius: 11, padding: 11, marginBottom: 12 }}><CheckCircle2 size={17} />{message}</div>}
        {error && <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: '#fff0ef', color: '#9c3531', borderRadius: 11, padding: 11, marginBottom: 12, lineHeight: 1.5 }}><ShieldAlert size={17} style={{ flex: '0 0 auto', marginTop: 2 }} />{error}</div>}

        <section style={{ background: 'white', border: '1px solid #e3e5ec', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ padding: '15px 18px', borderBottom: '1px solid #eceef3' }}><strong>Danh sách token</strong></div>
          {loading ? <div style={{ padding: 28, textAlign: 'center', color: '#747986' }}>Đang tải…</div> : tokens.length === 0 ? <div style={{ padding: 30, textAlign: 'center', color: '#747986' }}>Chưa có token nguồn. Thêm token ở biểu mẫu phía trên.</div> : tokens.map((token) => {
            const info = statusInfo[token.status];
            return <article key={token.id} style={{ padding: 17, borderBottom: '1px solid #eef0f4', display: 'grid', gridTemplateColumns: 'minmax(220px,1.25fr) minmax(180px,.8fr) minmax(260px,1.5fr) auto', gap: 16, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{token.label}</strong>
                <small style={{ display: 'block', color: '#747986', marginTop: 4 }}>{token.metaUserName || 'Chưa nhận diện user'} {token.metaUserId ? `· ${token.metaUserId}` : ''}</small>
                <small style={{ display: 'block', color: '#9a9eaa', marginTop: 2, fontFamily: 'monospace' }}>FP {token.fingerprint}</small>
              </div>
              <div><span style={{ display: 'inline-block', background: info.bg, color: info.color, borderRadius: 999, padding: '5px 9px', fontSize: 12, fontWeight: 700 }}>{info.label}</span><small style={{ display: 'block', color: '#747986', marginTop: 5 }}>Kiểm tra: {formatDate(token.lastCheckedAt)}</small></div>
              <div style={{ minWidth: 0 }}>
                <small style={{ color: '#747986' }}>Lần dùng tạo BM: {formatDate(token.lastCreateAt)}</small>
                {token.lastCreateResult && <small style={{ display: 'block', marginTop: 3, color: '#747986' }}>Kết quả: {token.lastCreateResult}</small>}
                {token.lastError && <div title={token.lastError} style={{ marginTop: 5, fontSize: 12, color: '#a13a35', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.lastError}</div>}
              </div>
              <div style={{ display: 'flex', gap: 7 }}>
                <button type="button" disabled={busyId === token.id} onClick={() => void tokenAction('check', token.id)} title="Kiểm tra lại token" style={{ border: '1px solid #d9dce5', background: 'white', borderRadius: 9, padding: 8, cursor: 'pointer' }}>{busyId === token.id ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}</button>
                <button type="button" disabled={busyId === token.id} onClick={() => void tokenAction('delete', token.id)} title="Xóa token" style={{ border: '1px solid #efd5d3', background: '#fff7f6', color: '#a13a35', borderRadius: 9, padding: 8, cursor: 'pointer' }}><Trash2 size={16} /></button>
              </div>
            </article>;
          })}
        </section>
      </div>
    </main>
  );
}
