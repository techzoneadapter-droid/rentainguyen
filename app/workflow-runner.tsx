'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, CirclePause, CirclePlay, LoaderCircle, RefreshCw, ShieldAlert, X } from 'lucide-react';

type Step = {
  label?: string;
  status?: string;
  error?: string;
};

type Job = {
  id: string;
  name: string;
  status: string;
  reason?: string;
  count?: number;
  interval?: number;
  completed?: number;
  cursor?: number;
  steps?: Step[];
  nextAt?: number;
};

type WorkspaceResponse = {
  jobs?: Job[];
  connected?: boolean;
  error?: string;
};

type QueueResponse = {
  changed?: boolean;
  message?: string;
  error?: string;
};

const legacyWaiting = new Set([
  'Chá» cáº¥u hÃ¬nh Meta',
  'ÄÃ£ lÆ°u cáº¥u hÃ¬nh',
]);

function isWaiting(status: string) {
  return status === 'Chờ cấu hình Meta' || status === 'Đã lưu cấu hình' || legacyWaiting.has(status);
}

function isActive(status: string) {
  return status === 'Đang chạy' || status === 'Đang thực thi';
}

function statusTone(status: string) {
  if (status === 'Hoàn tất') return { background: '#eaf8ef', color: '#176b37' };
  if (status === 'Cần đối chiếu') return { background: '#fff1f0', color: '#a33a33' };
  if (status === 'Tạm dừng') return { background: '#fff7e7', color: '#8a5a00' };
  if (isActive(status)) return { background: '#eef2ff', color: '#3f4aac' };
  return { background: '#f3f4f6', color: '#50545c' };
}

export default function WorkflowRunner() {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/workspace', { cache: 'no-store' });
      const data = (await response.json()) as WorkspaceResponse;
      if (!response.ok) throw new Error(data.error || 'Không tải được workflow.');
      setJobs(data.jobs || []);
      setConnected(Boolean(data.connected));
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const queue = useCallback(async (action: 'start' | 'pause' | 'resume' | 'tick', id?: string) => {
    const response = await fetch('/api/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...(id ? { id } : {}) }),
    });
    const data = (await response.json()) as QueueResponse;
    if (!response.ok) throw new Error(data.error || 'Không thể cập nhật workflow.');
    return data;
  }, []);

  const runAction = useCallback(async (action: 'start' | 'pause' | 'resume', id: string) => {
    setBusyId(id);
    setError('');
    try {
      await queue(action, id);
      await load();
      setOpen(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId('');
    }
  }, [load, queue]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  const hasActive = useMemo(() => jobs.some((job) => isActive(job.status)), [jobs]);

  useEffect(() => {
    if (!hasActive) return;

    let running = false;
    const tick = async () => {
      if (running || document.visibilityState !== 'visible') return;
      running = true;
      try {
        const result = await queue('tick');
        if (result.changed) await load();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        running = false;
      }
    };

    const initial = window.setTimeout(() => void tick(), 0);
    const timer = window.setInterval(() => void tick(), 2500);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [hasActive, load, queue]);

  const actionable = jobs.filter((job) => isWaiting(job.status) || isActive(job.status) || job.status === 'Tạm dừng' || job.status === 'Cần đối chiếu');
  const activeCount = jobs.filter((job) => isActive(job.status)).length;

  return (
    <div style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 80, width: open ? 'min(420px, calc(100vw - 36px))' : 'auto' }}>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 9, border: '1px solid #d9dce3', borderRadius: 999, background: '#17181c', color: 'white', padding: '11px 15px', boxShadow: '0 10px 30px rgba(0,0,0,.18)', cursor: 'pointer' }}
          aria-label="Mở bộ điều khiển workflow"
        >
          {activeCount ? <LoaderCircle size={17} className="spin" /> : <CirclePlay size={17} />}
          Workflow {activeCount ? `· ${activeCount} đang chạy` : ''}
          <ChevronUp size={15} />
        </button>
      ) : (
        <section style={{ border: '1px solid #dfe1e6', borderRadius: 18, background: 'white', boxShadow: '0 18px 50px rgba(0,0,0,.2)', overflow: 'hidden' }} aria-label="Bộ điều khiển workflow">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '13px 14px', borderBottom: '1px solid #eceef2' }}>
            <div>
              <strong style={{ display: 'block', fontSize: 14 }}>Bộ điều khiển workflow</strong>
              <small style={{ color: '#6c7078' }}>{connected ? 'Meta đã được cấu hình' : 'Chưa có kết nối Meta'}</small>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" onClick={() => void load()} aria-label="Làm mới" style={{ border: 0, background: 'transparent', padding: 7, cursor: 'pointer' }}><RefreshCw size={17} /></button>
              <button type="button" onClick={() => setOpen(false)} aria-label="Thu gọn" style={{ border: 0, background: 'transparent', padding: 7, cursor: 'pointer' }}><ChevronDown size={18} /></button>
            </div>
          </div>

          {error && (
            <div role="alert" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 14px', background: '#fff5f4', color: '#8b2f2a', fontSize: 12 }}>
              <ShieldAlert size={16} style={{ flex: '0 0 auto', marginTop: 1 }} />
              <span style={{ flex: 1 }}>{error}</span>
              <button type="button" onClick={() => setError('')} aria-label="Đóng lỗi" style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer' }}><X size={14} /></button>
            </div>
          )}

          <div style={{ maxHeight: '58vh', overflow: 'auto', padding: 10 }}>
            {loading ? (
              <div style={{ padding: 18, textAlign: 'center', color: '#747880', fontSize: 13 }}>Đang tải workflow…</div>
            ) : actionable.length === 0 ? (
              <div style={{ padding: 18, textAlign: 'center', color: '#747880', fontSize: 13 }}>Chưa có workflow đang chờ hoặc đang chạy.</div>
            ) : actionable.map((job) => {
              const total = job.steps?.length || 0;
              const completed = Math.max(0, Number(job.completed || 0));
              const percent = total ? Math.min(100, Math.round((completed / total) * 100)) : 0;
              const busy = busyId === job.id;
              const tone = statusTone(job.status);
              return (
                <article key={job.id} style={{ border: '1px solid #e5e7eb', borderRadius: 13, padding: 12, marginBottom: 9 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.name}</strong>
                      <small style={{ color: '#747880' }}>{job.count || 1} mục · {job.interval || 30} giây/thao tác</small>
                    </div>
                    <span style={{ ...tone, borderRadius: 999, padding: '4px 8px', fontSize: 11, whiteSpace: 'nowrap' }}>{job.status}</span>
                  </div>

                  {total > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ height: 6, borderRadius: 999, background: '#eceef2', overflow: 'hidden' }}>
                        <div style={{ width: `${percent}%`, height: '100%', background: '#5b61d6', transition: 'width .2s ease' }} />
                      </div>
                      <small style={{ display: 'block', marginTop: 5, color: '#747880' }}>{completed}/{total} bước · {percent}%</small>
                    </div>
                  )}

                  {job.reason && <p style={{ margin: '9px 0 0', fontSize: 12, lineHeight: 1.45, color: job.status === 'Cần đối chiếu' ? '#8b2f2a' : '#60646c' }}>{job.reason}</p>}

                  {job.status === 'Cần đối chiếu' && <small style={{ display: 'block', marginTop: 7, color: '#8b2f2a' }}>Workflow này không tự thử lại. Hãy đối chiếu kết quả trên Meta trước.</small>}

                  <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
                    {isWaiting(job.status) && (
                      <button type="button" disabled={!connected || busy} onClick={() => void runAction('start', job.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, borderRadius: 9, background: '#17181c', color: 'white', padding: '8px 10px', cursor: !connected || busy ? 'not-allowed' : 'pointer', opacity: !connected || busy ? .55 : 1 }}>
                        {busy ? <LoaderCircle size={14} className="spin" /> : <CirclePlay size={14} />} Bắt đầu
                      </button>
                    )}
                    {job.status === 'Đang chạy' && (
                      <button type="button" disabled={busy} onClick={() => void runAction('pause', job.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #d9dce3', borderRadius: 9, background: 'white', padding: '8px 10px', cursor: busy ? 'not-allowed' : 'pointer' }}>
                        <CirclePause size={14} /> Tạm dừng
                      </button>
                    )}
                    {job.status === 'Tạm dừng' && (
                      <button type="button" disabled={busy} onClick={() => void runAction('resume', job.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, borderRadius: 9, background: '#17181c', color: 'white', padding: '8px 10px', cursor: busy ? 'not-allowed' : 'pointer' }}>
                        <CirclePlay size={14} /> Tiếp tục
                      </button>
                    )}
                    {job.status === 'Đang thực thi' && <small style={{ alignSelf: 'center', color: '#60646c' }}>Đang chờ phản hồi Meta…</small>}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
