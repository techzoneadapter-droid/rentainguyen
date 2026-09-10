'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Building2,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  Mail,
  RefreshCw,
  ShieldAlert,
  X,
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
  lastError?: string;
};

type PageItem = { id: string; name: string; tasks?: string[] };
type TokenResponse = { tokens?: TokenItem[]; error?: string };
type PagesResponse = {
  pages?: PageItem[];
  error?: string;
  hint?: string;
  tokenStatus?: TokenStatus;
};

type CreateResult = {
  id?: string;
  name?: string;
  saved?: boolean;
  message?: string;
  error?: string;
  tokenStatus?: TokenStatus;
  business?: {
    id: string;
    name: string;
    status: string;
    verificationStatus: string;
    verified: boolean;
    creationTime: string;
    timezoneId: string;
    primaryPage: { id: string; name?: string };
    createdBy: { id: string; name?: string };
  };
  invite?: {
    requested: boolean;
    email?: string;
    status: 'not_requested' | 'pending' | 'failed';
    error?: string;
  };
};

const createButtonText = ['Tạo tài nguyên', 'Táº¡o tÃ i nguyÃªn'];
const tokenLabels: Record<TokenStatus, string> = {
  active: 'Hoạt động',
  invalid: 'Hết hạn / không hợp lệ',
  permission_issue: 'Thiếu quyền',
  rate_limited: 'Rate limit',
  create_restricted: 'Bị giới hạn tạo BM',
  unknown_error: 'Cần kiểm tra',
};

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  border: '1px solid #d9dce3',
  borderRadius: 10,
  padding: '11px 12px',
  font: 'inherit',
  background: 'white',
};

function isBusinessManagerPage() {
  return (document.querySelector('main h1')?.textContent?.trim() || '') === 'Business Manager';
}

function formatTime(value?: string) {
  if (!value) return 'Chưa rõ';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
}

function verificationLabel(value?: string) {
  if (!value || value === 'unknown') return 'Chưa rõ';
  if (value.toLowerCase() === 'verified') return 'Đã xác minh';
  return value;
}

export default function BusinessManagerCreator() {
  const [open, setOpen] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [tokenId, setTokenId] = useState('');
  const [pages, setPages] = useState<PageItem[]>([]);
  const [primaryPage, setPrimaryPage] = useState('');
  const [manualPage, setManualPage] = useState(false);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [loadingPages, setLoadingPages] = useState(false);
  const [pagesError, setPagesError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CreateResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const selectedToken = useMemo(
    () => tokens.find((token) => token.id === tokenId),
    [tokens, tokenId],
  );

  const loadTokens = useCallback(async () => {
    setLoadingTokens(true);
    try {
      const response = await fetch('/api/meta-tokens', { cache: 'no-store' });
      const data = (await response.json()) as TokenResponse;
      if (!response.ok) throw new Error(data.error || 'Không tải được token nguồn.');
      const next = data.tokens || [];
      setTokens(next);
      setTokenId((current) =>
        current && next.some((item) => item.id === current)
          ? current
          : (next.find((item) => item.status === 'active')?.id || next[0]?.id || ''),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingTokens(false);
    }
  }, []);

  const loadPages = useCallback(async (id: string) => {
    if (!id) return;
    setLoadingPages(true);
    setPagesError('');
    try {
      const response = await fetch(`/api/business-manager?tokenId=${encodeURIComponent(id)}`, {
        cache: 'no-store',
      });
      const data = (await response.json()) as PagesResponse;
      if (!response.ok) {
        setPages([]);
        setPrimaryPage('');
        setManualPage(true);
        setPagesError(`${data.error || 'Không đọc được danh sách Page.'}${data.hint ? ` ${data.hint}` : ''}`);
        await loadTokens();
        return;
      }
      const nextPages = data.pages || [];
      setPages(nextPages);
      setPrimaryPage(nextPages[0]?.id || '');
      setManualPage(nextPages.length === 0);
      if (nextPages.length === 0) {
        setPagesError('Token không trả về Page nào. Meta vẫn yêu cầu một Page đại diện khi tạo Business Manager; bạn có thể nhập Page ID thủ công nếu tài khoản có quyền quản lý Page đó.');
      }
    } catch (err) {
      setPages([]);
      setPrimaryPage('');
      setManualPage(true);
      setPagesError((err as Error).message);
    } finally {
      setLoadingPages(false);
    }
  }, [loadTokens]);

  const openCreator = useCallback(() => {
    setOpen(true);
    setError('');
    setPagesError('');
    setResult(null);
    setConfirmed(false);
    setPages([]);
    setPrimaryPage('');
    setManualPage(false);
    void loadTokens();
  }, [loadTokens]);

  useEffect(() => {
    const updateVisibility = () => setShowFallback(isBusinessManagerPage());
    const observer = new MutationObserver(updateVisibility);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    queueMicrotask(updateVisibility);

    const capture = (event: MouseEvent) => {
      if (!isBusinessManagerPage()) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest('button');
      if (!button) return;
      const text = button.textContent?.trim() || '';
      if (!createButtonText.some((label) => text.includes(label))) return;
      event.preventDefault();
      event.stopPropagation();
      openCreator();
    };

    document.addEventListener('click', capture, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('click', capture, true);
    };
  }, [openCreator]);

  useEffect(() => {
    if (!open || !tokenId) return;
    const timer = window.setTimeout(() => void loadPages(tokenId), 0);
    return () => window.clearTimeout(timer);
  }, [open, tokenId, loadPages]);

  function openTokenManager() {
    setOpen(false);
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('[data-token-manager-nav]')?.click();
    }, 0);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setResult(null);
    if (!tokenId) {
      setError('Chọn một token nguồn trước khi tạo BM.');
      return;
    }
    if (!primaryPage) {
      setError('Meta yêu cầu một Facebook Page đại diện. Hãy chọn Page hoặc nhập Page ID hợp lệ.');
      return;
    }
    if (!confirmed) {
      setError('Bạn cần xác nhận Business Manager này dùng cho doanh nghiệp của bạn hoặc khách hàng đã ủy quyền.');
      return;
    }

    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      const response = await fetch('/api/business-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId,
          name: String(form.get('name') || ''),
          primaryPage,
          adminEmail: String(form.get('adminEmail') || ''),
          timezone: Number(form.get('timezone') || 140),
          vertical: String(form.get('vertical') || 'ADVERTISING'),
          purposeConfirmed: true,
        }),
      });
      const data = (await response.json()) as CreateResult;
      if (!response.ok) {
        setError(data.error || 'Không tạo được Business Manager.');
        await loadTokens();
        return;
      }
      setResult(data);
      await loadTokens();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const selectedLabel = selectedToken ? tokenLabels[selectedToken.status] : '';
  const blocked = !tokenId || !primaryPage || selectedToken?.status === 'invalid';
  const inviteFailed = result?.invite?.status === 'failed';

  return (
    <>
      {showFallback && !open && (
        <button type="button" onClick={openCreator} style={{ position: 'fixed', right: 168, bottom: 18, zIndex: 79, display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid #6d4bd8', borderRadius: 999, background: '#7353e8', color: 'white', padding: '11px 14px', boxShadow: '0 10px 30px rgba(82,54,170,.2)', fontWeight: 700 }}>
          <Building2 size={16} /> Tạo BM thật
        </button>
      )}

      {open && (
        <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) setOpen(false); }} style={{ position: 'fixed', inset: 0, zIndex: 120, display: 'grid', placeItems: 'center', padding: 18, background: 'rgba(20,22,28,.42)', backdropFilter: 'blur(2px)' }}>
          <section role="dialog" aria-modal="true" aria-label="Tạo Business Manager thật" style={{ width: 'min(650px,100%)', maxHeight: '90vh', overflow: 'auto', borderRadius: 20, background: 'white', boxShadow: '0 24px 80px rgba(0,0,0,.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '20px 22px 14px', borderBottom: '1px solid #eceef3' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span style={{ display: 'grid', placeItems: 'center', width: 42, height: 42, borderRadius: 12, background: '#f0ebff', color: '#6d4bd8' }}><Building2 size={21} /></span>
                <div><strong style={{ display: 'block', fontSize: 18 }}>Tạo Business Manager thật</strong><small style={{ color: '#747880' }}>Tạo 1 BM/lần · chọn token nguồn · có thể gửi lời mời ADMIN sau khi tạo</small></div>
              </div>
              <button type="button" disabled={submitting} onClick={() => setOpen(false)} aria-label="Đóng" style={{ border: 0, background: 'transparent', padding: 6 }}><X size={20} /></button>
            </div>

            <div style={{ padding: '16px 22px 22px' }}>
              {result?.id ? (
                <div>
                  <div style={{ textAlign: 'center', padding: '8px 4px 14px' }}>
                    <CheckCircle2 size={42} style={{ margin: '0 auto 9px', color: '#26864b' }} />
                    <h3 style={{ margin: 0, fontSize: 20 }}>Business Manager đã được tạo</h3>
                    <p style={{ color: '#646871', lineHeight: 1.55, marginTop: 7 }}>{result.message}</p>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                    {[
                      ['Tên BM', result.business?.name || result.name || ''],
                      ['Business ID', result.business?.id || result.id || ''],
                      ['Trạng thái', result.business?.status || 'Truy cập được'],
                      ['Xác minh', verificationLabel(result.business?.verificationStatus)],
                      ['Page đại diện', result.business?.primaryPage?.name ? `${result.business.primaryPage.name} · ${result.business.primaryPage.id}` : result.business?.primaryPage?.id || primaryPage],
                      ['Người tạo', result.business?.createdBy?.name ? `${result.business.createdBy.name} · ${result.business.createdBy.id}` : result.business?.createdBy?.id || selectedToken?.metaUserName || ''],
                      ['Múi giờ Meta', result.business?.timezoneId || 'Chưa rõ'],
                      ['Thời gian tạo', formatTime(result.business?.creationTime)],
                    ].map(([label, value]) => (
                      <div key={label} style={{ border: '1px solid #e7e8ed', borderRadius: 10, padding: 11, minWidth: 0 }}>
                        <small style={{ color: '#777b83' }}>{label}</small>
                        <strong style={{ display: 'block', marginTop: 4, overflowWrap: 'anywhere', fontSize: 13 }}>{value}</strong>
                      </div>
                    ))}
                  </div>

                  {result.invite?.requested && (
                    <div style={{ borderRadius: 10, padding: 11, marginBottom: 12, background: inviteFailed ? '#fff1f0' : '#eef9f2', color: inviteFailed ? '#9c302d' : '#21643a', lineHeight: 1.5, fontSize: 12 }}>
                      <strong>{inviteFailed ? 'BM đã tạo, nhưng gửi lời mời ADMIN thất bại' : 'Đã gửi lời mời ADMIN'}</strong>
                      <div>{result.invite.email}</div>
                      {inviteFailed ? <div style={{ marginTop: 4 }}>{result.invite.error}</div> : <div style={{ marginTop: 4 }}>Người nhận cần mở email và chấp nhận lời mời của Meta.</div>}
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
                    <button type="button" onClick={() => { setResult(null); setConfirmed(false); }} style={{ border: '1px solid #d9dce3', borderRadius: 10, background: 'white', padding: '10px 13px' }}>Tạo BM khác</button>
                    <button type="button" onClick={() => window.location.reload()} style={{ border: 0, borderRadius: 10, background: '#7353e8', color: 'white', padding: '10px 14px', fontWeight: 700 }}>Tải lại workspace</button>
                  </div>
                </div>
              ) : (
                <form onSubmit={submit}>
                  <div style={{ border: '1px solid #e0e2e8', borderRadius: 13, padding: 12, marginBottom: 14, background: '#fafafd' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 700, fontSize: 13 }}><KeyRound size={16} /> Token nguồn</span>
                      <button type="button" onClick={openTokenManager} style={{ border: 0, background: 'transparent', color: '#6d4bd8', fontSize: 12, padding: 0 }}>Quản lý token →</button>
                    </div>
                    {loadingTokens ? <div style={{ display: 'flex', gap: 7, alignItems: 'center', color: '#747880', fontSize: 13 }}><LoaderCircle size={15} className="spin" /> Đang tải token…</div> : tokens.length ? <><select value={tokenId} onChange={(event) => setTokenId(event.target.value)} style={inputStyle}>{tokens.map((token) => <option key={token.id} value={token.id}>{token.label} · {token.metaUserName || token.metaUserId || 'chưa nhận diện'} · {tokenLabels[token.status]}</option>)}</select>{selectedToken && <div style={{ marginTop: 8, fontSize: 12, color: selectedToken.status === 'active' ? '#21643a' : '#8a5d00', lineHeight: 1.45 }}><strong>{selectedLabel}</strong> · FP {selectedToken.fingerprint}{selectedToken.lastError ? <div style={{ marginTop: 3, color: '#9c3531' }}>{selectedToken.lastError}</div> : null}</div>}</> : <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: '#8a5d00', fontSize: 12, lineHeight: 1.45 }}><ShieldAlert size={16} /><span>Chưa có token nguồn. Đóng hộp thoại và mở mục <strong>Quản lý token</strong> ở menu bên trái để thêm token.</span></div>}
                  </div>

                  <label style={{ display: 'block', marginBottom: 13 }}><span style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Tên Business Manager</span><input name="name" required minLength={2} maxLength={100} placeholder="VD: Nguyen Media" style={inputStyle} /></label>

                  <div style={{ display: 'block', marginBottom: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>Page đại diện</span>
                      <button type="button" disabled={!tokenId || loadingPages} onClick={() => tokenId && void loadPages(tokenId)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 0, background: 'transparent', color: '#6d4bd8', fontSize: 11, padding: 0 }}><RefreshCw size={13} className={loadingPages ? 'spin' : ''} /> Đọc lại Page</button>
                    </div>
                    {loadingPages ? <div style={{ ...inputStyle, color: '#747880', display: 'flex', alignItems: 'center', gap: 7 }}><LoaderCircle size={15} className="spin" /> Đang đọc các Page tài khoản quản lý…</div> : !manualPage && pages.length ? <select value={primaryPage} onChange={(event) => setPrimaryPage(event.target.value)} style={inputStyle}>{pages.map((page) => <option key={page.id} value={page.id}>{page.name} · {page.id}</option>)}</select> : <input value={primaryPage} onChange={(event) => setPrimaryPage(event.target.value.replace(/\D/g, ''))} inputMode="numeric" pattern="[0-9]{5,30}" placeholder="Nhập Facebook Page ID" style={inputStyle} />}
                    <small style={{ display: 'block', marginTop: 5, color: '#747880', lineHeight: 1.45 }}>Meta bắt buộc có một Page đại diện khi tạo Business Manager qua API. App ưu tiên tự đọc Page từ token để bạn không phải nhập ID.</small>
                    {pagesError && <div style={{ marginTop: 5, fontSize: 11, color: '#9a6a17', lineHeight: 1.45 }}>{pagesError}</div>}
                    {!manualPage && pages.length > 0 && <button type="button" onClick={() => { setManualPage(true); setPrimaryPage(''); }} style={{ border: 0, background: 'transparent', color: '#777b83', padding: '5px 0 0', fontSize: 11 }}>Nhập Page ID thủ công</button>}
                  </div>

                  <label style={{ display: 'block', marginBottom: 13 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, marginBottom: 6 }}><Mail size={15} /> Email quản trị sau khi tạo</span>
                    <input name="adminEmail" type="email" maxLength={254} placeholder="VD: admin@congty.com (có thể để trống)" style={inputStyle} />
                    <small style={{ display: 'block', marginTop: 5, color: '#747880', lineHeight: 1.45 }}>Nếu điền email, sau khi BM tạo thành công app sẽ gửi lời mời vai trò ADMIN qua Meta. Người nhận phải chấp nhận lời mời.</small>
                  </label>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 13 }}>
                    <label><span style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Múi giờ</span><select name="timezone" defaultValue="140" style={inputStyle}><option value="140">Việt Nam · Asia/Ho Chi Minh</option><option value="128">Singapore</option><option value="132">Bangkok</option><option value="136">Taipei</option><option value="1">Los Angeles</option><option value="7">New York</option></select></label>
                    <label><span style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Lĩnh vực</span><select name="vertical" defaultValue="ADVERTISING" style={inputStyle}><option value="ADVERTISING">Advertising</option><option value="ECOMMERCE">Ecommerce</option><option value="MARKETING">Marketing</option><option value="TECHNOLOGY">Technology</option><option value="RETAIL">Retail</option><option value="PROFESSIONAL_SERVICES">Professional Services</option><option value="OTHER">Other</option></select></label>
                  </div>

                  <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', border: '1px solid #e3e5ea', borderRadius: 12, padding: 11, fontSize: 12, lineHeight: 1.45, marginBottom: 13 }}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} style={{ marginTop: 2 }} /><span>Tôi xác nhận BM này dùng cho doanh nghiệp của tôi hoặc khách hàng đã ủy quyền. Ứng dụng không tự đổi token hoặc tự retry để vượt giới hạn của Meta.</span></label>

                  {error && <div role="alert" style={{ borderRadius: 10, padding: 10, background: '#fff1f0', color: '#9c302d', fontSize: 12, lineHeight: 1.5, marginBottom: 13 }}>{error}</div>}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}><button type="button" disabled={submitting} onClick={() => setOpen(false)} style={{ border: '1px solid #d9dce3', borderRadius: 10, background: 'white', padding: '10px 13px' }}>Hủy</button><button type="submit" disabled={blocked || submitting || !confirmed} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 0, borderRadius: 10, background: '#7353e8', color: 'white', padding: '10px 14px', cursor: blocked || submitting || !confirmed ? 'not-allowed' : 'pointer', opacity: blocked || submitting || !confirmed ? .55 : 1, fontWeight: 700 }}>{submitting ? <LoaderCircle size={16} className="spin" /> : <Building2 size={16} />}{submitting ? 'Đang tạo và đọc trạng thái…' : 'Tạo BM trên Meta'}</button></div>
                  <p style={{ color: '#777b83', fontSize: 11, lineHeight: 1.5, margin: '14px 0 0' }}>Nếu BM tạo thành công nhưng bước mời admin lỗi, app vẫn lưu BM và hiển thị riêng lỗi lời mời; không gửi lại request tạo BM.</p>
                </form>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
