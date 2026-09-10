'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Building2, CheckCircle2, LoaderCircle, ShieldCheck, X } from 'lucide-react';

type MetaStatus = {
  connected?: boolean;
  version?: string;
  user?: { id: string; name: string };
  error?: string;
};

type CreateResult = {
  id?: string;
  name?: string;
  saved?: boolean;
  message?: string;
  error?: string;
};

const createButtonText = ['Tạo tài nguyên', 'Táº¡o tÃ i nguyÃªn'];

function isBusinessManagerPage() {
  const heading = document.querySelector('main h1')?.textContent?.trim() || '';
  return heading === 'Business Manager';
}

export default function BusinessManagerCreator() {
  const [open, setOpen] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [status, setStatus] = useState<MetaStatus>({});
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CreateResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const checkConnection = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch('/api/business-manager', { cache: 'no-store' });
      const data = (await response.json()) as MetaStatus;
      setStatus(data);
    } catch (err) {
      setStatus({ connected: false, error: (err as Error).message });
    } finally {
      setChecking(false);
    }
  }, []);

  const openCreator = useCallback(() => {
    setOpen(true);
    setError('');
    setResult(null);
    setConfirmed(false);
    void checkConnection();
  }, [checkConnection]);

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
    if (!confirmed) {
      setError('Bạn cần xác nhận Business Manager này dùng cho doanh nghiệp của bạn hoặc khách hàng đã ủy quyền.');
      return;
    }

    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get('name') || ''),
      primaryPage: String(form.get('primaryPage') || ''),
      timezone: Number(form.get('timezone') || 140),
      vertical: String(form.get('vertical') || 'ADVERTISING'),
      purposeConfirmed: true,
    };

    setSubmitting(true);
    try {
      const response = await fetch('/api/business-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as CreateResult;
      if (!response.ok) throw new Error(data.error || 'Không tạo được Business Manager.');
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {showFallback && !open && (
        <button
          type="button"
          onClick={openCreator}
          style={{
            position: 'fixed',
            right: 168,
            bottom: 18,
            zIndex: 79,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            border: '1px solid #6d4bd8',
            borderRadius: 999,
            background: '#7353e8',
            color: 'white',
            padding: '11px 14px',
            boxShadow: '0 10px 30px rgba(82,54,170,.2)',
            cursor: 'pointer',
            fontWeight: 700,
          }}
        >
          <Building2 size={16} /> Tạo BM thật
        </button>
      )}

      {open && (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !submitting) setOpen(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 120,
            display: 'grid',
            placeItems: 'center',
            padding: 18,
            background: 'rgba(20,22,28,.42)',
            backdropFilter: 'blur(2px)',
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Tạo Business Manager thật"
            style={{
              width: 'min(590px, 100%)',
              maxHeight: '90vh',
              overflow: 'auto',
              borderRadius: 20,
              background: 'white',
              boxShadow: '0 24px 80px rgba(0,0,0,.25)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '20px 22px 14px', borderBottom: '1px solid #eceef3' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span style={{ display: 'grid', placeItems: 'center', width: 42, height: 42, borderRadius: 12, background: '#f0ebff', color: '#6d4bd8' }}><Building2 size={21} /></span>
                <div>
                  <strong style={{ display: 'block', fontSize: 18 }}>Tạo Business Manager thật</strong>
                  <small style={{ color: '#747880' }}>Gửi trực tiếp qua Meta Graph API chính thức · 1 BM mỗi lần</small>
                </div>
              </div>
              <button type="button" disabled={submitting} onClick={() => setOpen(false)} aria-label="Đóng" style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 6 }}><X size={20} /></button>
            </div>

            <div style={{ padding: '16px 22px 22px' }}>
              <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: 12, borderRadius: 12, background: status.connected ? '#eef9f2' : '#fff7e8', color: status.connected ? '#21643a' : '#7a5611', fontSize: 13, marginBottom: 16 }}>
                {checking ? <LoaderCircle size={17} className="spin" /> : <ShieldCheck size={17} />}
                <div>
                  <strong>{checking ? 'Đang kiểm tra kết nối Meta…' : status.connected ? `Đã kết nối Meta ${status.version || ''}` : 'Chưa kết nối Meta'}</strong>
                  <div style={{ marginTop: 3 }}>
                    {status.connected
                      ? `Token đang nhận diện ${status.user?.name || 'người dùng Meta'}; token không được gửi xuống trình duyệt.`
                      : status.error || 'Cấu hình META_ACCESS_TOKEN ở môi trường server/local rồi khởi động lại npm run dev.'}
                  </div>
                </div>
              </div>

              {result?.id ? (
                <div style={{ textAlign: 'center', padding: '18px 4px 4px' }}>
                  <CheckCircle2 size={42} style={{ margin: '0 auto 10px', color: '#26864b' }} />
                  <h3 style={{ margin: 0, fontSize: 20 }}>Đã tạo trên Meta</h3>
                  <p style={{ color: '#646871', lineHeight: 1.55 }}>{result.message}</p>
                  <div style={{ border: '1px solid #e3e5ea', borderRadius: 12, padding: 12, textAlign: 'left', margin: '14px 0' }}>
                    <small style={{ color: '#777b83' }}>Business ID</small>
                    <strong style={{ display: 'block', marginTop: 3, fontFamily: 'monospace' }}>{result.id}</strong>
                  </div>
                  <button type="button" onClick={() => window.location.reload()} style={{ border: 0, borderRadius: 10, background: '#7353e8', color: 'white', padding: '10px 14px', cursor: 'pointer', fontWeight: 700 }}>Tải lại workspace</button>
                </div>
              ) : (
                <form onSubmit={submit}>
                  <label style={{ display: 'block', marginBottom: 13 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Tên Business Manager</span>
                    <input name="name" required minLength={2} maxLength={100} placeholder="VD: Nguyen Media" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d9dce3', borderRadius: 10, padding: '11px 12px', font: 'inherit' }} />
                  </label>

                  <label style={{ display: 'block', marginBottom: 13 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Primary Facebook Page ID</span>
                    <input name="primaryPage" required inputMode="numeric" pattern="[0-9]{5,30}" placeholder="ID Page mà bạn đang quản lý" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d9dce3', borderRadius: 10, padding: '11px 12px', font: 'inherit' }} />
                    <small style={{ display: 'block', marginTop: 5, color: '#747880' }}>Meta yêu cầu một Page đại diện cho business; người tạo BM phải quản lý Page này.</small>
                  </label>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 13 }}>
                    <label>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Múi giờ</span>
                      <select name="timezone" defaultValue="140" style={{ width: '100%', border: '1px solid #d9dce3', borderRadius: 10, padding: '11px 10px', background: 'white', font: 'inherit' }}>
                        <option value="140">Việt Nam · Asia/Ho Chi Minh</option>
                        <option value="128">Singapore</option>
                        <option value="132">Bangkok</option>
                        <option value="136">Taipei</option>
                        <option value="1">Los Angeles</option>
                        <option value="7">New York</option>
                      </select>
                    </label>
                    <label>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Lĩnh vực</span>
                      <select name="vertical" defaultValue="ADVERTISING" style={{ width: '100%', border: '1px solid #d9dce3', borderRadius: 10, padding: '11px 10px', background: 'white', font: 'inherit' }}>
                        <option value="ADVERTISING">Advertising</option>
                        <option value="ECOMMERCE">Ecommerce</option>
                        <option value="MARKETING">Marketing</option>
                        <option value="TECHNOLOGY">Technology</option>
                        <option value="RETAIL">Retail</option>
                        <option value="PROFESSIONAL_SERVICES">Professional Services</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </label>
                  </div>

                  <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', border: '1px solid #e3e5ea', borderRadius: 12, padding: 11, fontSize: 12, lineHeight: 1.45, marginBottom: 13 }}>
                    <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} style={{ marginTop: 2 }} />
                    <span>Tôi xác nhận BM này dùng cho doanh nghiệp của tôi hoặc khách hàng đã ủy quyền. Tôi không dùng chức năng này để né giới hạn hoặc tạo BM hàng loạt.</span>
                  </label>

                  {error && <div role="alert" style={{ borderRadius: 10, padding: 10, background: '#fff1f0', color: '#9c302d', fontSize: 12, lineHeight: 1.5, marginBottom: 13 }}>{error}</div>}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
                    <button type="button" disabled={submitting} onClick={() => setOpen(false)} style={{ border: '1px solid #d9dce3', borderRadius: 10, background: 'white', padding: '10px 13px', cursor: 'pointer' }}>Hủy</button>
                    <button type="submit" disabled={!status.connected || submitting || !confirmed} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 0, borderRadius: 10, background: '#7353e8', color: 'white', padding: '10px 14px', cursor: !status.connected || submitting || !confirmed ? 'not-allowed' : 'pointer', opacity: !status.connected || submitting || !confirmed ? .55 : 1, fontWeight: 700 }}>
                      {submitting ? <LoaderCircle size={16} className="spin" /> : <Building2 size={16} />}
                      {submitting ? 'Đang gửi sang Meta…' : 'Tạo BM trên Meta'}
                    </button>
                  </div>

                  <p style={{ color: '#777b83', fontSize: 11, lineHeight: 1.5, margin: '14px 0 0' }}>Không có cơ chế tự retry. Nếu request timeout hoặc mất kết nối sau khi gửi, hãy kiểm tra Business Settings trước khi thử lại để tránh tạo trùng.</p>
                </form>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
