import Link from 'next/link';
import ProductionQueue from '../production-queue';
import QueueAutoOpen from './queue-auto-open';

export default function QueuePage() {
  return (
    <div style={{ minHeight: '100vh', background: '#f5f7fb' }}>
      <aside className="sidebar" style={{ display: 'none' }}>
        <nav />
      </aside>
      <div className="main-wrap">
        <main style={{ padding: 32 }}>
          <div className="panel" style={{ padding: 24 }}>
            <h1>Hàng đợi sản xuất</h1>
            <p className="muted">Đang khởi tạo màn hình hàng đợi…</p>
            <Link href="/new">Quay lại dashboard mới</Link>
          </div>
        </main>
        <ProductionQueue />
        <QueueAutoOpen />
      </div>
    </div>
  );
}
