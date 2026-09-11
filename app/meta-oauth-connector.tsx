'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, LoaderCircle, LogIn, RefreshCw, ShieldAlert, X } from 'lucide-react';

type OAuthNotice = { kind: 'success' | 'error'; message: string } | null;
type LocalProfile = { directory: string; name: string };
type LocalBrowser = { id: string; name: string; profiles: LocalProfile[] };
type ProfilesResponse = { browsers?: LocalBrowser[]; error?: string };
type LaunchResponse = { ok?: boolean; browser?: string; profile?: string; error?: string };

const HELPER_URL = 'http://127.0.0.1:5174';

export default function MetaOAuthConnector() {
  const [actionTarget, setActionTarget] = useState<Element | null>(null);
  const [notice, setNotice] = useState<OAuthNotice>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [pickerError, setPickerError] = useState('');
  const [browsers, setBrowsers] = useState<LocalBrowser[]>([]);
  const [selectedBrowser, setSelectedBrowser] = useState('');
  const [selectedProfile, setSelectedProfile] = useState('');

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

  const currentBrowser = useMemo(
    () => browsers.find((browser) => browser.id === selectedBrowser) || browsers[0],
    [browsers, selectedBrowser],
  );

  async function loadProfiles() {
    setPickerLoading(true);
    setPickerError('');
    try {
      const response = await fetch(`${HELPER_URL}/profiles`, { cache: 'no-store' });
      const data = (await response.json()) as ProfilesResponse;
      if (!response.ok) throw new Error(data.error || 'Không đọc được danh sách profile trình duyệt.');
      const next = data.browsers || [];
      setBrowsers(next);
      const firstBrowser = next[0];
      setSelectedBrowser(firstBrowser?.id || '');
      setSelectedProfile(firstBrowser?.profiles[0]?.directory || '');
      if (!firstBrowser) {
        setPickerError('Không tìm thấy profile Chrome, Edge hoặc Brave trên máy này.');
      }
    } catch {
      setBrowsers([]);
      setSelectedBrowser('');
      setSelectedProfile('');
      setPickerError('Browser helper chưa chạy. Hãy khởi động lại tool bằng npm run dev rồi thử lại.');
    } finally {
      setPickerLoading(false);
    }
  }

  function openPicker() {
    setPickerOpen(true);
    void loadProfiles();
  }

  function changeBrowser(browserId: string) {
    setSelectedBrowser(browserId);
    const browser = browsers.find((item) => item.id === browserId);
    setSelectedProfile(browser?.profiles[0]?.directory || '');
  }

  async function launchSelectedProfile() {
    if (!currentBrowser || !selectedProfile) {
      setPickerError('Hãy chọn trình duyệt và profile trước.');
      return;
    }

    setLaunching(true);
    setPickerError('');
    try {
      const response = await fetch(`${HELPER_URL}/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          browserId: currentBrowser.id,
          profileDirectory: selectedProfile,
        }),
      });
      const data = (await response.json()) as LaunchResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || 'Không mở được profile đã chọn.');
      setPickerOpen(false);
      setNotice({
        kind: 'success',
        message: `Đã mở OAuth trong ${data.browser || currentBrowser.name} · ${data.profile || selectedProfile}. Nếu Facebook yêu cầu checkpoint/2FA, đóng cửa sổ đó và chọn profile khác.`,
      });
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : 'Không mở được profile đã chọn.');
    } finally {
      setLaunching(false);
    }
  }

  const button = actionTarget
    ? createPortal(
        <button
          className="button primary"
          type="button"
          onClick={openPicker}
          title="Chọn profile trình duyệt đã đăng nhập Facebook rồi mở OAuth chính thức của Meta"
        >
          <LogIn size={16} /> Kết nối Facebook
        </button>,
        actionTarget,
      )
    : null;

  const pickerPortal = pickerOpen
    ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Chọn profile trình duyệt"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99998,
            display: 'grid',
            placeItems: 'center',
            padding: 20,
            background: 'rgba(25,27,35,.48)',
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !launching) setPickerOpen(false);
          }}
        >
          <div className="panel" style={{ width: 'min(560px,100%)', padding: 22, boxShadow: '0 24px 70px rgba(0,0,0,.22)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 18 }}>
              <div>
                <div className="eyebrow">FACEBOOK OAUTH</div>
                <h2 style={{ marginTop: 5 }}>Chọn trình duyệt & profile</h2>
                <p className="muted" style={{ marginTop: 6, lineHeight: 1.55 }}>
                  Chọn profile đã đăng nhập đúng tài khoản Facebook. Tool chỉ đọc tên profile để mở OAuth, không đọc cookie, mật khẩu hay token từ trình duyệt.
                </p>
              </div>
              <button className="button" type="button" disabled={launching} onClick={() => setPickerOpen(false)} aria-label="Đóng">
                <X size={16} />
              </button>
            </div>

            {pickerLoading ? (
              <div className="muted" style={{ padding: '24px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <LoaderCircle size={18} className="spin" /> Đang tìm profile trình duyệt…
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <small className="muted">Trình duyệt</small>
                    <select value={currentBrowser?.id || ''} onChange={(event) => changeBrowser(event.target.value)} disabled={!browsers.length || launching}>
                      {!browsers.length && <option value="">Không tìm thấy</option>}
                      {browsers.map((browser) => <option key={browser.id} value={browser.id}>{browser.name}</option>)}
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <small className="muted">Profile</small>
                    <select value={selectedProfile} onChange={(event) => setSelectedProfile(event.target.value)} disabled={!currentBrowser || launching}>
                      {!currentBrowser && <option value="">Không có profile</option>}
                      {currentBrowser?.profiles.map((profile) => (
                        <option key={profile.directory} value={profile.directory}>{profile.name} · {profile.directory}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {pickerError && (
                  <div style={{ marginTop: 14, padding: 10, borderRadius: 8, background: '#fff0ef', color: '#9c3531', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <ShieldAlert size={16} style={{ marginTop: 2 }} />
                    <span>{pickerError}</span>
                  </div>
                )}

                <div style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <button className="button" type="button" disabled={pickerLoading || launching} onClick={() => void loadProfiles()}>
                    <RefreshCw size={16} /> Quét lại profile
                  </button>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="button" type="button" disabled={launching} onClick={() => window.location.assign('/api/meta-oauth/start')}>
                      Dùng profile hiện tại
                    </button>
                    <button className="button primary" type="button" disabled={!currentBrowser || !selectedProfile || launching} onClick={() => void launchSelectedProfile()}>
                      {launching ? <LoaderCircle size={16} className="spin" /> : <LogIn size={16} />}
                      {launching ? 'Đang mở…' : 'Mở OAuth'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
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

  return <>{button}{pickerPortal}{noticePortal}</>;
}
