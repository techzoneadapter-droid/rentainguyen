'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Facebook, ShieldAlert } from 'lucide-react';

type OAuthNotice = { kind: 'success' | 'error'; message: string } | null;

export default function MetaOAuthConnector() {
  const [actionTarget, setActionTarget] = useState<Element | null>(null);
  const [notice, setNotice] = useState<OAuthNotice>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('metaOauth');
    const message = params.get('message') || '';
    let opened = false;

    const sync = () => {
      const target = document.querySelector('.token-workspace-main .heading-actions');
      setActionTarget(target);

      if (!opened && (result === 'success' || result === 'error')) {
        const navButton = document.querySelector('[data-token-manager-nav]');
        if (navButton instanceof HTMLButtonElement) {
          opened = true;
          navButton.click();
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('metaOauth');
          cleanUrl.searchParams.delete('message');
          window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
        }
      }
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setTimeout(() => {
      if (result === 'success' || result === 'error') {
        setNotice({
          kind: result,
          message: message || (result === 'success' ? 'Đã kết nối Facebook.' : 'Không kết nối được Facebook.'),
        });
      }
      sync();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  const button = actionTarget
    ? createPortal(
        <button
          className="button primary"
          type="button"
          onClick={() => window.location.assign('/api/meta-oauth/start')}
          title="Kết nối tài khoản Facebook hiện tại bằng OAuth chính thức của Meta"
        >
          <Facebook size={16} /> Kết nối Facebook
        </button>,
        actionTarget,
      )
    : null;

  const noticePortal = notice
    ? createPortal(
        <div
          role="status"
          style={{
            position: 'fixed',
            right: 22,
            top: 22,
            zIndex: 99999,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 9,
            maxWidth: 460,
            padding: '12px 14px',
            borderRadius: 10,
            boxShadow: '0 12px 36px rgba(0,0,0,.16)',
            background: notice.kind === 'success' ? '#eaf8ef' : '#fff0ef',
            color: notice.kind === 'success' ? '#176b37' : '#9c3531',
          }}
          onClick={() => setNotice(null)}
        >
          {notice.kind === 'success' ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
          <span style={{ lineHeight: 1.45 }}>{notice.message}</span>
        </div>,
        document.body,
      )
    : null;

  return <>{button}{noticePortal}</>;
}
