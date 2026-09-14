'use client';

import { lazy, Suspense, useState } from 'react';

type Mode = 'off' | 'new' | 'stable';

const NewDashboard = lazy(() => import('./eztool-clone-dashboard'));
const StableDashboard = lazy(() => import('./eztool-dashboard'));

const shellStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: '#f3f6fb',
  color: '#1f2937',
  fontFamily: 'Arial, sans-serif',
  display: 'grid',
  placeItems: 'center',
  padding: 24,
};

const cardStyle: React.CSSProperties = {
  width: 'min(760px, 100%)',
  background: '#fff',
  border: '1px solid #dbe3ef',
  borderRadius: 18,
  boxShadow: '0 16px 44px rgba(31, 41, 55, .08)',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  background: 'linear-gradient(90deg, #2f76ed 0%, #7656d9 100%)',
  color: '#fff',
  padding: '20px 24px',
};

const buttonStyle: React.CSSProperties = {
  border: 0,
  borderRadius: 10,
  padding: '12px 18px',
  fontWeight: 700,
  cursor: 'pointer',
};

export default function SafeAppLauncher() {
  const [mode, setMode] = useState<Mode>('off');

  if (mode === 'new') {
    return (
      <Suspense fallback={<div style={shellStyle}>Đang bật giao diện mới...</div>}>
        <NewDashboard />
      </Suspense>
    );
  }

  if (mode === 'stable') {
    return (
      <Suspense fallback={<div style={shellStyle}>Đang bật giao diện ổn định...</div>}>
        <StableDashboard />
      </Suspense>
    );
  }

  return (
    <main style={shellStyle}>
      <section style={cardStyle}>
        <div style={headerStyle}>
          <div style={{ fontSize: 13, opacity: .85, marginBottom: 6 }}>ADS WORKSPACE</div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Chế độ khởi động an toàn</h1>
        </div>
        <div style={{ padding: 24 }}>
          <p style={{ marginTop: 0, lineHeight: 1.6 }}>
            Khi vừa mở localhost, app sẽ không tự đọc token, không tự gọi workspace, không tự check tài nguyên
            và không chạy browser-profile helper. Chỉ khi bạn bấm mở app thì các module tương ứng mới được nạp.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 20 }}>
            <button
              type="button"
              onClick={() => setMode('new')}
              style={{ ...buttonStyle, background: '#7656d9', color: '#fff' }}
            >
              Mở giao diện mới
            </button>
            <button
              type="button"
              onClick={() => setMode('stable')}
              style={{ ...buttonStyle, background: '#eef2ff', color: '#4f46e5' }}
            >
              Mở bản ổn định
            </button>
          </div>
          <div style={{ marginTop: 18, padding: 14, borderRadius: 10, background: '#f8fafc', fontSize: 13, lineHeight: 1.6 }}>
            Nếu giao diện mới còn lỗi client-runtime, dùng “Mở bản ổn định” để tiếp tục làm việc. Không có tác vụ Meta nào chạy chỉ vì bạn mở trang này.
          </div>
        </div>
      </section>
    </main>
  );
}
