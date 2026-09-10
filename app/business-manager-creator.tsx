'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Building2, CheckCircle2, KeyRound, LoaderCircle, ShieldAlert, X } from 'lucide-react';

type TokenStatus = 'active' | 'invalid' | 'permission_issue' | 'rate_limited' | 'create_restricted' | 'unknown_error';
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
type TokenResponse = { tokens?: TokenItem[]; error?: string };
type CreateResult = { id?: string; name?: string; saved?: boolean; message?: string; error?: string; tokenStatus?: TokenStatus };

const createButtonText = ['Tạo tài nguyên', 'Táº¡o tÃ i nguyÃªn'];
const tokenLabels: Record<TokenStatus, string> = {
  active: 'Hoạt động',
  invalid: 'Hết hạn / không hợp lệ',
  permission_issue: 'Thiếu quyền',
  rate_limited: 'Rate limit',
  create_restricted: 'Bị giới hạn tạo BM',
  unknown_error: 'Cần kiểm tra',
};

function isBusinessManagerPage() {
  return (document.querySelector('main h1')?.textContent?.trim() || '') === 'Business Manager';
}

export default function BusinessManagerCreator() {
  const [open, setOpen] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [tokenId, setTokenId] = useState('');
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CreateResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const selectedToken = useMemo(() => tokens.find((token) => token.id === tokenId), [tokens, tokenId]);

  const loadTokens = useCallback(async () => {
    setLoadingTokens(true);
    try {
      const response = await fetch('/api/meta-tokens', { cache: 'no-store' });
      const data = (await response.json()) as TokenResponse;
      if (!response.ok) throw new Error(data.error || 'Không tải được token nguồn.');
      const next = data.tokens || [];
      setTokens(next);
      setTokenId((current) => current && next.some((item) => item.id === current) ? current : (next.find((item) => item.status === 'active')?.id || next[0]?.id || ''));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingTokens(false);
    }
  }, []);

  const openCreator = useCallback(() => {
    setOpen(true);
    setError('');
    setResult(null);
    setConfirmed(false);
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setResult(null);
    if (!tokenId) {
      setError('Chọn một token nguồn trước khi tạo BM.');
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
          primaryPage: String(form.get('primaryPage') || ''),
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
  const blocked = !tokenId || selectedToken?.status === 'invalid';

  return (
    <>
      {showFallback && !open && <button type="button" onClick={openCreator} style={{ position: 'fixed', right: 168, bottom: 18, zIndex: 79, display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid #6d4bd8', borderRadius: 999, background: '#7353e8', color: 'white', padding: '11px 14px', boxShadow: '0 10px 30px rgba(82,54,170,.2)', cursor: 'pointer', fontWeight: 700 }}><Building2 size={16} /> Tạo BM thật</button>}

      {open && <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) setOpen(false); }} style={{ position: 'fixed', inset: 0, zIndex: 120, display: 'grid', placeItems: 'center', padding: 18, background: 'rgba(20,22,28,.42)', backdropFilter: 'blur(2px)' }}>
        <section role="dialog" aria-modal="true" aria-label="Tạo Business Manager thật" style={{ width: 'min(610px, 100%)', maxHeight: '90vh', overflow: 'auto', borderRadius: 20, background: 'white', boxShadow: '0 24px 80px rgba(0,0,0,.25)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '20px 22px 14px', borderBottom: '1px solid #eceef3' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><span style={{ display: 'grid', placeItems: 'center', width: 42, height: 42, borderRadius: 12, background: '#f0ebff', color: '#6d4bd8' }}><Building2 size={21} /></span><div><strong style={{ display: 'block', fontSize: 18 }}>Tạo Business Manager thật</strong><small style={{ color: '#747880' }}>Chọn thủ công token nguồn · 1 BM mỗi lần · không tự đổi token</small></div></div>
            <button type="button" disabled={submitting} onClick={() => setOpen(false)} aria-label="Đóng" style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 6 }}><X size={20} /></button>
          </div>

          <div style={{ padding: '16px 22px 22px' }}>
            {result?.id ? <div style={{ textAlign: 'center', padding: '18px 4px 4px' }}><CheckCircle2 size={42} style={{ margin: '0 auto 10px', color: '#26864b' }} /><h3 style={{ margin: 0, fontSize: 20 }}>Đã tạo trên Meta</h3><p style={{ color: '#646871', lineHeight: 1.55 }}>{result.message}</p><div style={{ border: '1px solid #e3e5ea', borderRadius: 12, padding: 12, textAlign: 'left', margin: '14px 0' }}><small style={{ color: '#777b83' }}>Business ID</small><strong style={{ display: 'block', marginTop: 3, fontFamily: 'monospace' }}>{result.id}</strong></div><button type="button" onClick={() => window.location.reload()} style={{ border: 0, borderRadius: 10, background: '#7353e8', color: 'white', padding: '10px 14px', cursor: 'pointer', fontWeight: 700 }}>Tải lại workspace</button></div> : <form onSubmit={submit}>
              <div style={{ border: '1px solid #e0e2e8', borderRadius: 13, padding: 12, marginBottom: 14, background: '#fafafd' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 700, fontSize: 13 }}><KeyRound size={16} /> Token nguồn</span><Link href="/tokens" target="_blank" style={{ color: '#6d4bd8', fontSize: 12, textDecoration: 'none' }}>Quản lý token →</Link></div>
                {loadingTokens ? <div style={{ display: 'flex', gap: 7, alignItems: 'center', color: '#747880', fontSize: 13 }}><LoaderCircle size={15} className="spin" /> Đang tải token…</div> : tokens.length ? <><select value={tokenId} onChange={(event) => setTokenId(event.target.value)} style={{ width: '100%', border: '1px solid #d9dce3', borderRadius: 10, padding: '10px 11px', background: 'white' }}>{tokens.map((token) => <option key={token.id} value={token.id}>{token.label} · {token.metaUserName || token.metaUserId || 'chưa nhận diện'} · {tokenLabels[token.status]}</option>)}</select>{selectedToken && <div style={{ marginTop: 8, fontSize: 12, color: selectedToken.status === 'active' ? '#21643a' : '#8a5d00', lineHeight: 1.45 }}><strong>{selectedLabel}</strong> · FP {selectedToken.fingerprint}{selectedToken.lastError ? <div style={{ marginTop: 3, color: '#9c3531' }}>{selectedToken.lastError}</div> : null}</div>}</> : <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: '#8a5d00', fontSize: 12, lineHeight: 1.45 }}><ShieldAlert size={16} /><span>Chưa có token nguồn. Mở <Link href="/tokens" target="_blank">trang Token nguồn</Link> để thêm và kiểm tra token trước.</span></div>}
              </div>

              <label style={{ display: 'block', marginBottom: 13 }}><span style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Tên Business Manager</span><input name="name" required minLength={2} maxLength={100} placeholder="VD: Nguyen Media" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d9dce3', borderRadius: 10, padding: '11px 12px', font: 'inherit' }} /></label>
              <label style={{ display: 'block', marginBottom: 13 }}><span style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Primary Facebook Page ID</span><input name="primaryPage" required inputMode="numeric" pattern="[0-9]{5,30}" placeholder="ID Page mà token đang đại diện có quyền quản lý" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d9dce3', borderRadius: 10, padding: '11px 12px', font: 'inherit' }} /><small style={{ display: 'block', marginTop: 5, color: '#747880' }}>Page phải phù hợp với user đứng sau token nguồn đã chọn.</small></label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 13 }}><label><span style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Múi giờ</span><select name="timezone" defaultValue="140" style={{ width: '100%', border: '1px solid #d9dce3', borderRadius: 10, padding: '11px 10px', background: 'white' }}><option value="140">Việt Nam · Asia/Ho Chi Minh</option><option value="128">Singapore</option><option value="132">Bangkok</option><option value="136">Taipei</option><option value="1">Los Angeles</option><option value="7">New York</option></select></label><label><span style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Lĩnh vực</span><select name="vertical" defaultValue="ADVERTISING" style={{ width: '100%', border: '1px solid #d9dce3', borderRadius: 10, padding: '11px 10px', background: 'white' }}><option value="ADVERTISING">Advertising</option><option value="ECOMMERCE">Ecommerce</option><option value="MARKETING">Marketing</option><option value="TECHNOLOGY">Technology</option><option value="RETAIL">Retail</option><option value="PROFESSIONAL_SERVICES">Professional Services</option><option value="OTHER">Other</option></select></label></div>
              <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', border: '1px solid #e3e5ea', borderRadius: 12, padding: 11, fontSize: 12, lineHeight: 1.45, marginBottom: 13 }}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} style={{ marginTop: 2 }} /><span>Tôi xác nhận BM này dùng cho doanh nghiệp của tôi hoặc khách hàng đã ủy quyền. Token nguồn được chọn thủ công; ứng dụng không tự chuyển token để vượt giới hạn của Meta.</span></label>
              {error && <div role="alert" style={{ borderRadius: 10, padding: 10, background: '#fff1f0', color: '#9c302d', fontSize: 12, lineHeight: 1.5, marginBottom: 13 }}>{error}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}><button type="button" disabled={submitting} onClick={() => setOpen(false)} style={{ border: '1px solid #d9dce3', borderRadius: 10, background: 'white', padding: '10px 13px', cursor: 'pointer' }}>Hủy</button><button type="submit" disabled={blocked || submitting || !confirmed} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 0, borderRadius: 10, background: '#7353e8', color: 'white', padding: '10px 14px', cursor: blocked || submitting || !confirmed ? 'not-allowed' : 'pointer', opacity: blocked || submitting || !confirmed ? .55 : 1, fontWeight: 700 }}>{submitting ? <LoaderCircle size={16} className="spin" /> : <Building2 size={16} />}{submitting ? 'Đang gửi sang Meta…' : 'Tạo BM trên Meta'}</button></div>
              <p style={{ color: '#777b83', fontSize: 11, lineHeight: 1.5, margin: '14px 0 0' }}>Nếu Meta từ chối, trạng thái và lỗi của token nguồn sẽ được cập nhật ở trang Token nguồn. Không tự retry và không tự đổi sang token khác.</p>
            </form>}
          </div>
        </section>
      </div>}
    </>
  );
}
