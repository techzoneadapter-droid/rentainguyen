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

const buttonBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 44,
  padding: '0 18px',
  borderRadius: 10,
  textDecoration: 'none',
  fontWeight: 700,
};

export default function Page() {
  return (
    <main style={shellStyle}>
      <section style={cardStyle}>
        <div style={{ background: 'linear-gradient(90deg, #2f76ed 0%, #7656d9 100%)', color: '#fff', padding: '20px 24px' }}>
          <div style={{ fontSize: 13, opacity: .85, marginBottom: 6 }}>ADS WORKSPACE</div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Chế độ khởi động an toàn</h1>
        </div>
        <div style={{ padding: 24 }}>
          <p style={{ marginTop: 0, lineHeight: 1.65 }}>
            Trang này không chạy token, workspace, check tài nguyên hay browser helper. Chỉ khi bạn bấm mở một giao diện thì module đó mới được tải.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 20 }}>
            <a href="/new" style={{ ...buttonBase, background: '#7656d9', color: '#fff' }}>Mở giao diện mới</a>
            <a href="/stable" style={{ ...buttonBase, background: '#eef2ff', color: '#4f46e5' }}>Mở bản ổn định</a>
          </div>
          <div style={{ marginTop: 18, padding: 14, borderRadius: 10, background: '#f8fafc', fontSize: 13, lineHeight: 1.6 }}>
            Nếu một giao diện lỗi client-runtime, quay lại trang này. Vì launcher được render phía server nên nó vẫn phải hiện ngay cả khi JavaScript phía client gặp lỗi.
          </div>
        </div>
      </section>
    </main>
  );
}
