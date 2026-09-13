'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BadgeCheck,
  Boxes,
  Building2,
  ChevronDown,
  CircleGauge,
  CreditCard,
  Flag,
  KeyRound,
  Layers3,
  Megaphone,
  PanelLeftClose,
  PanelLeftOpen,
  ScanLine,
  Search,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  Workflow,
} from 'lucide-react';
import styles from './eztool-reference-skin.module.css';

const toolCards = [
  { label: 'Quản lý TKQC', description: 'Theo dõi trạng thái và tài nguyên tài khoản quảng cáo.', icon: CreditCard },
  { label: 'Quản lý Pixel', description: 'Quản lý Pixel/Dataset và BM liên quan.', icon: ScanLine },
  { label: 'Quản lý Camp', description: 'Xem chiến dịch, nhóm quảng cáo và trạng thái phân phối.', icon: Megaphone },
  { label: 'Quản lý BM', description: 'Tập trung BM và tài nguyên liên quan.', icon: Building2 },
  { label: 'Check BM', description: 'Kiểm tra trạng thái và xác minh doanh nghiệp.', icon: ShieldCheck },
  { label: 'Quản lý Page', description: 'Theo dõi Page và quyền tài nguyên đang có.', icon: Flag },
  { label: 'Tra cứu UID', description: 'Tra cứu nhanh ID từ dữ liệu đầu vào hợp lệ.', icon: Search },
  { label: 'Xử lý Text', description: 'Lọc trùng, chuẩn hóa và xử lý danh sách.', icon: WandSparkles },
];

const extraTools = [
  ['Tạo BM', 'Tạo BM từ token'],
  ['Tài nguyên', 'Trung tâm tài nguyên'],
  ['Hàng đợi', 'Hàng đợi'],
  ['Preset', 'Preset'],
  ['Bí kíp', 'Bí kíp'],
  ['Token', 'Token'],
  ['OAuth', 'OAuth'],
  ['CRM', 'CRM'],
  ['Workflow', 'Workflow'],
] as const;

function clickMatching(text: string) {
  const candidates = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar button, .main-wrap header button'));
  const needle = text.trim().toLowerCase();
  const target = candidates.find((button) => (button.textContent || '').trim().toLowerCase().includes(needle));
  target?.click();
  return Boolean(target);
}

export default function EztoolReferenceSkin() {
  const [headerTarget, setHeaderTarget] = useState<Element | null>(null);
  const [homeTarget, setHomeTarget] = useState<Element | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [isHome, setIsHome] = useState(true);

  useEffect(() => {
    const homeSlotId = 'eztool-reference-home-slot';

    const patch = () => {
      const sidebar = document.querySelector<HTMLElement>('.sidebar');
      const mainWrap = document.querySelector<HTMLElement>('.main-wrap');
      const header = mainWrap?.querySelector<HTMLElement>(':scope > header');
      const main = mainWrap?.querySelector<HTMLElement>(':scope > main');
      if (!sidebar || !mainWrap || !header || !main) return;

      document.documentElement.classList.add('eztool-ref-v2');
      sidebar.classList.add('eztool-ref-sidebar');
      mainWrap.classList.add('eztool-ref-mainwrap');
      header.classList.add('eztool-ref-header');
      main.classList.add('eztool-ref-main');
      setHeaderTarget(header);

      const breadcrumb = header.querySelector<HTMLElement>('.breadcrumb');
      const pageName = breadcrumb?.querySelector('strong')?.textContent?.trim() || '';
      const nowHome = pageName === 'Trang chủ' || pageName === '';
      setIsHome(nowHome);
      if (breadcrumb) breadcrumb.classList.add('eztool-ref-breadcrumb');

      const headerChildren = Array.from(header.children) as HTMLElement[];
      for (const child of headerChildren) {
        const text = child.textContent || '';
        if (text.includes('Tạo BM') && text.includes('Workflow') && text.includes('Token')) child.classList.add('eztool-ref-old-extra');
      }

      const navLabels = Array.from(sidebar.querySelectorAll<HTMLElement>('div'));
      for (const label of navLabels) {
        if (label.childElementCount === 0 && label.textContent?.trim() === 'PROFILE') {
          const section = label.parentElement as HTMLElement | null;
          if (section) section.style.display = 'none';
        }
      }

      const userStrong = Array.from(sidebar.querySelectorAll<HTMLElement>('strong')).find((node) => node.textContent?.includes('Nguyễn Workspace'));
      const userBox = userStrong?.closest('div')?.parentElement as HTMLElement | null;
      if (userBox && userBox.textContent?.includes('Nguyễn Workspace')) userBox.style.display = 'none';

      let slot = main.querySelector<HTMLElement>(`#${homeSlotId}`);
      if (!slot) {
        slot = document.createElement('div');
        slot.id = homeSlotId;
        main.insertBefore(slot, main.firstChild);
      }
      setHomeTarget(slot);

      const legacyHeading = Array.from(main.querySelectorAll<HTMLHeadingElement>('h1')).find((node) => node.textContent?.includes('Quản lý tài nguyên Facebook tập trung'));
      const hero = legacyHeading?.parentElement?.parentElement as HTMLElement | null;
      if (hero) {
        hero.dataset.ezLegacyHome = '1';
        let sibling = hero.nextElementSibling as HTMLElement | null;
        let count = 0;
        while (sibling && count < 3) {
          sibling.dataset.ezLegacyHome = '1';
          sibling = sibling.nextElementSibling as HTMLElement | null;
          count += 1;
        }
      }
    };

    patch();
    const observer = new MutationObserver(patch);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      document.documentElement.classList.remove('eztool-ref-v2');
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('eztool-ref-collapsed', collapsed);
    return () => document.documentElement.classList.remove('eztool-ref-collapsed');
  }, [collapsed]);

  const benefits = useMemo(() => [
    ['Tiết kiệm thời gian', 'Gom tác vụ theo đúng nhóm công việc để thao tác nhanh hơn.', CircleGauge],
    ['Tối ưu nguồn lực', 'Theo dõi BM, TKQC, Page và token trong một giao diện.', Layers3],
    ['Bảo mật cao', 'Token thô không hiển thị lại và được mã hóa ở backend.', ShieldCheck],
    ['Dễ bắt đầu', 'Bố cục rõ ràng, mở đúng nhóm là thấy ngay công cụ cần dùng.', Sparkles],
    ['Luôn cập nhật', 'Tách luồng chức năng để sửa và kiểm tra độc lập.', BadgeCheck],
    ['Vận hành tập trung', 'Giữ các công cụ riêng của workspace nhưng không làm rối menu chính.', Boxes],
  ] as const, []);

  const topAddon = headerTarget ? createPortal(
    <div className={styles.headerAddon}>
      <details className={styles.extraDropdown}>
        <summary><Boxes size={15} /> Công cụ riêng <ChevronDown size={14} /></summary>
        <div className={styles.dropdownPanel}>
          {extraTools.map(([label, match]) => (
            <button key={label} type="button" onClick={() => clickMatching(match)}>
              {label === 'Token' ? <KeyRound size={14} /> : label === 'Workflow' ? <Workflow size={14} /> : <Boxes size={14} />}
              <span>{label}</span>
            </button>
          ))}
        </div>
      </details>
      <button className={styles.collapseButton} type="button" onClick={() => setCollapsed((value) => !value)} title={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'}>
        {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
      </button>
    </div>,
    headerTarget,
  ) : null;

  const home = isHome && homeTarget ? createPortal(
    <div className={styles.home}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span>GIẢI PHÁP CHO NHÀ QUẢNG CÁO FACEBOOK</span>
          <h1>Quản lý tài nguyên Facebook tối ưu hơn</h1>
          <p>Gom các tác vụ quan trọng về Ads, BM, Page và token vào một giao diện thống nhất để kiểm tra nhanh, giảm thao tác lặp và theo dõi tài nguyên rõ ràng hơn.</p>
          <div className={styles.heroActions}>
            <button type="button" onClick={() => clickMatching('Phân loại token')}><KeyRound size={16} /> Phân loại token</button>
            <button type="button" className={styles.secondary} onClick={() => clickMatching('Quản lý TKQC')}><CreditCard size={16} /> Quản lý TKQC</button>
          </div>
        </div>
        <div className={styles.heroVisual}>
          <div className={styles.visualTop}><span /><span /><span /></div>
          <div className={styles.visualBody}>
            <div className={styles.visualSide}>
              <i /><i /><i /><i /><i />
            </div>
            <div className={styles.visualContent}>
              <div className={styles.fakeTitle} />
              <div className={styles.fakeStats}><span /><span /><span /></div>
              <div className={styles.fakeTable}>{Array.from({ length: 5 }).map((_, index) => <span key={index} />)}</div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>
          <div><span>VẬN HÀNH GỌN HƠN</span><h2>Những lợi ích khi vận hành cùng ADS WORKSPACE</h2></div>
          <p>Bố cục chia theo mục tiêu sử dụng, ưu tiên thao tác nhanh và khả năng nhìn tổng quan.</p>
        </div>
        <div className={styles.benefitGrid}>
          {benefits.map(([title, description, Icon]) => <article key={title}><div><Icon size={18} /></div><h3>{title}</h3><p>{description}</p></article>)}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitle}>
          <div><span>KHO TIỆN ÍCH</span><h2>Công cụ theo từng nhóm tài nguyên quảng cáo</h2></div>
          <p>Chọn một công cụ để mở đúng màn hình vận hành tương ứng.</p>
        </div>
        <div className={styles.toolGrid}>
          {toolCards.map(({ label, description, icon: Icon }) => (
            <button key={label} type="button" onClick={() => clickMatching(label)}>
              <span className={styles.toolIcon}><Icon size={19} /></span>
              <span className={styles.toolText}><strong>{label}</strong><small>{description}</small></span>
              <span className={styles.toolArrow}>→</span>
            </button>
          ))}
        </div>
      </section>
    </div>,
    homeTarget,
  ) : null;

  return <>{topAddon}{home}</>;
}
