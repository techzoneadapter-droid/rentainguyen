'use client';

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen,
  Boxes,
  Building2,
  ChevronRight,
  Factory,
  HeartPulse,
  KeyRound,
  PlugZap,
  Send,
  SlidersHorizontal,
  Wrench,
  Workflow as WorkflowIcon,
  X,
} from 'lucide-react';
import styles from './new-tool-bridge.module.css';

type ToolKey =
  | 'tokens'
  | 'bm-create'
  | 'resources'
  | 'health'
  | 'queue'
  | 'preset'
  | 'guides'
  | 'oauth'
  | 'crm'
  | 'workflow';

type ToolInfo = {
  key: ToolKey;
  label: string;
  description: string;
  section: 'TÀI NGUYÊN & TOKEN' | 'VẬN HÀNH' | 'KẾT NỐI';
  icon: typeof Wrench;
};

const BulkTokenCenter = lazy(() => import('./bulk-token-center'));
const BmTokenCreatorHub = lazy(() => import('./bm-token-creator-hub'));
const ResourceCenter = lazy(() => import('./resource-center'));
const BulkHealthCheck = lazy(() => import('./bulk-health-check'));
const ProductionQueue = lazy(() => import('./production-queue'));
const ResourcePresetManager = lazy(() => import('./resource-preset-manager'));
const GuideWorkspaceSection = lazy(() => import('./guide-workspace-section'));
const MetaOAuthConnector = lazy(() => import('./meta-oauth-connector'));
const CrmResourcePush = lazy(() => import('./crm-resource-push'));
const WorkflowRunner = lazy(() => import('./workflow-runner'));

const tools: ToolInfo[] = [
  { key: 'tokens', label: 'Kho token nâng cao', description: 'Bộ lọc, sắp xếp, quyền, tài nguyên và tác vụ token cũ.', section: 'TÀI NGUYÊN & TOKEN', icon: KeyRound },
  { key: 'bm-create', label: 'Tạo BM từ token', description: 'Giữ nguyên preflight, Page đại diện, timezone, vertical và kết quả BM.', section: 'TÀI NGUYÊN & TOKEN', icon: Building2 },
  { key: 'resources', label: 'Trung tâm tài nguyên', description: 'BM, TKQC, Page, Pixel/Dataset và trạng thái vòng đời.', section: 'TÀI NGUYÊN & TOKEN', icon: Boxes },
  { key: 'health', label: 'Health Check hàng loạt', description: 'Kiểm tra trạng thái tài nguyên bằng token đã lưu.', section: 'TÀI NGUYÊN & TOKEN', icon: HeartPulse },
  { key: 'queue', label: 'Hàng đợi sản xuất', description: 'Giữ nguyên hàng đợi BM, pause/resume/retry và tiến trình.', section: 'VẬN HÀNH', icon: Factory },
  { key: 'preset', label: 'Preset tài nguyên', description: 'Các cấu hình tạo tài nguyên đã lưu trước đây.', section: 'VẬN HÀNH', icon: SlidersHorizontal },
  { key: 'workflow', label: 'Workflow', description: 'Giữ nguyên workflow runner và dữ liệu workspace hiện có.', section: 'VẬN HÀNH', icon: WorkflowIcon },
  { key: 'guides', label: 'Bí kíp / tài liệu', description: 'Kho hướng dẫn nội bộ đã có trong app.', section: 'VẬN HÀNH', icon: BookOpen },
  { key: 'oauth', label: 'OAuth Meta', description: 'Chỉ bật khi bạn chủ động dùng luồng kết nối OAuth.', section: 'KẾT NỐI', icon: PlugZap },
  { key: 'crm', label: 'Đẩy sang CRM', description: 'Giữ nguyên luồng đẩy tài nguyên sang CRM.', section: 'KẾT NỐI', icon: Send },
];

function ToolModule({ tool }: { tool: ToolKey }) {
  if (tool === 'tokens') return <BulkTokenCenter />;
  if (tool === 'bm-create') return <BmTokenCreatorHub />;
  if (tool === 'resources') return <ResourceCenter />;
  if (tool === 'health') return <BulkHealthCheck />;
  if (tool === 'queue') return <ProductionQueue />;
  if (tool === 'preset') return <ResourcePresetManager />;
  if (tool === 'guides') return <GuideWorkspaceSection />;
  if (tool === 'oauth') return <MetaOAuthConnector />;
  if (tool === 'crm') return <CrmResourcePush />;
  return <WorkflowRunner />;
}

export default function NewToolBridge() {
  const [sideTarget, setSideTarget] = useState<Element | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolKey | null>(null);
  const navHostRef = useRef<HTMLElement | null>(null);
  const headerHostRef = useRef<HTMLElement | null>(null);

  const activeInfo = useMemo(
    () => tools.find((tool) => tool.key === activeTool) || null,
    [activeTool],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const candidate = Array.from(document.querySelectorAll('aside')).find(
        (aside) => !aside.hasAttribute('data-legacy-tool-target'),
      );
      setSideTarget(candidate || null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!activeTool) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const buttons = [
        ...Array.from(navHostRef.current?.querySelectorAll('button') || []),
        ...Array.from(headerHostRef.current?.querySelectorAll('button') || []),
      ].filter((button) => button.dataset.bridgeAnchor !== '1');

      const button = buttons.find((item) => item.dataset.bridgeAutoClicked !== '1');
      if (button) {
        button.dataset.bridgeAutoClicked = '1';
        button.click();
        window.clearInterval(timer);
      } else if (attempts >= 50) {
        window.clearInterval(timer);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [activeTool]);

  function openTool(key: ToolKey) {
    setDrawerOpen(false);
    setActiveTool(key);
  }

  const sidebarButton = sideTarget
    ? createPortal(
        <button type="button" className={styles.sideTrigger} onClick={() => setDrawerOpen(true)}>
          <Wrench size={17} />
          <span>
            Công cụ đầy đủ
            <small>Toàn bộ logic app cũ</small>
          </span>
          <ChevronRight size={15} />
        </button>,
        sideTarget,
      )
    : null;

  const sections = ['TÀI NGUYÊN & TOKEN', 'VẬN HÀNH', 'KẾT NỐI'] as const;

  return (
    <>
      {sidebarButton}

      <aside data-legacy-tool-target="1" className={`sidebar ${styles.hiddenTarget}`} aria-hidden="true">
        <nav ref={navHostRef} />
      </aside>

      <div
        className={`main-wrap ${styles.compatMain} ${activeTool ? styles.compatOpen : ''}`}
        aria-hidden={activeTool ? undefined : true}
      >
        <header ref={headerHostRef} className={styles.hiddenTarget}>
          <button type="button" data-bridge-anchor="1">Token</button>
        </header>
      </div>

      {activeTool && activeInfo && (
        <>
          <div className={styles.activeBar}>
            <strong>{activeInfo.label}</strong>
            <button type="button" aria-label="Đóng công cụ" onClick={() => setActiveTool(null)}>
              <X size={16} />
            </button>
          </div>
          <Suspense fallback={<div className={styles.loading}>Đang nạp {activeInfo.label}…</div>}>
            <ToolModule tool={activeTool} />
          </Suspense>
        </>
      )}

      {drawerOpen && (
        <>
          <button className={styles.drawerScrim} type="button" aria-label="Đóng" onClick={() => setDrawerOpen(false)} />
          <section className={styles.drawer} aria-label="Toàn bộ công cụ">
            <div className={styles.drawerHead}>
              <Wrench size={22} />
              <div>
                <strong>Toàn bộ công cụ ADS WORKSPACE</strong>
                <small>Chỉ module bạn bấm mới được nạp; các module khác không chạy nền.</small>
              </div>
              <button type="button" aria-label="Đóng" onClick={() => setDrawerOpen(false)}><X size={17} /></button>
            </div>
            <div className={styles.drawerBody}>
              {sections.map((section) => (
                <div key={section}>
                  <div className={styles.sectionTitle}>{section}</div>
                  {tools.filter((tool) => tool.section === section).map((tool) => {
                    const Icon = tool.icon;
                    return (
                      <button className={styles.toolButton} type="button" key={tool.key} onClick={() => openTool(tool.key)}>
                        <span className={styles.toolIcon}><Icon size={18} /></span>
                        <span><strong>{tool.label}</strong><small>{tool.description}</small></span>
                        <span className={styles.status}>Đã nối</span>
                      </button>
                    );
                  })}
                </div>
              ))}
              <div className={styles.notice}>
                Kho token dùng chung cho giao diện mới và các công cụ cũ. Các chức năng cần cookie/private endpoint, thu số thẻ/CVV hoặc cố vượt giới hạn Meta không được tự chạy; các mục đó vẫn để ở trạng thái khóa/thông báo trong giao diện.
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
