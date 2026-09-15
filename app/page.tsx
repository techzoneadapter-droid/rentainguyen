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
  width: 'min(820px, 100%)',
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
          <h1 style={{ margin: 0, fontSize: 24 }}>Trung tâm khởi động</h1>
        </div>
        <div style={{ padding: 24 }}>
          <p style={{ marginTop: 0, lineHeight: 1.65 }}>
            <strong>/new</strong> là dashboard chính cho Token → BM/ADS/Page → công cụ vận hành. Trang này không tự chạy token hay Meta API để luôn còn một điểm vào an toàn nếu giao diện client gặp lỗi.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 20 }}>
            <a href="/new" style={{ ...buttonBase, background: '#7656d9', color: '#fff' }}>Mở dashboard chính</a>
            <a href="/queue" style={{ ...buttonBase, background: '#e8f2ff', color: '#245fae' }}>Mở hàng đợi sản xuất</a>
            <a href="/stable" style={{ ...buttonBase, background: '#f1f3f7', color: '#4b5563' }}>Mở giao diện legacy</a>
          </div>
          <div style={{ marginTop: 18, padding: 14, borderRadius: 10, background: '#f8fafc', fontSize: 13, lineHeight: 1.6 }}>
            Luồng khuyến nghị: dùng <strong>/new</strong> cho thao tác Meta thật, <strong>/queue</strong> cho hàng đợi tạo BM từng bước; <strong>/stable</strong> chỉ giữ làm fallback trong giai đoạn chuyển đổi.
          </div>
        </div>
      </section>
    </main>
  );
}
