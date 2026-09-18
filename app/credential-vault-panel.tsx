'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, Search, Trash2, WalletCards } from 'lucide-react';

type CredentialAccount = {
  id: string;
  label: string;
  uid: string;
  name: string;
  hasCookie: boolean;
  hasToken: boolean;
  sessionId?: string;
  tokenId?: string;
  cookieStatus?: string;
  tokenStatus?: string;
  lastError?: string;
  businessCount?: number | null;
  pageCount?: number | null;
  adAccountCount?: number | null;
};

async function jsonFetch<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json() as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
  return data;
}

function statusText(account: CredentialAccount) {
  const parts: string[] = [];
  if (account.hasCookie) parts.push(`Cookie ${account.cookieStatus === 'active' ? 'LIVE' : account.cookieStatus === 'invalid' ? 'DIE' : '\u2014'}`);
  if (account.hasToken) parts.push(`Token ${account.tokenStatus === 'active' ? 'LIVE' : account.tokenStatus === 'invalid' ? 'DIE' : account.tokenStatus === 'permission_issue' ? 'API kh\u00f4ng nh\u1eadn' : '\u2014'}`);
  return parts.join(' \u00b7 ') || '\u0110\u00e3 l\u01b0u';
}

export default function CredentialVaultPanel() {
  const [open, setOpen] = useState(false);
  const [nav, setNav] = useState<HTMLElement | null>(null);
  const [accounts, setAccounts] = useState<CredentialAccount[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const find = () => {
      const el = document.querySelector('header nav') as HTMLElement | null;
      setNav(el);
    };
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    const reload = () => { void load(); };
    window.addEventListener('meta-credentials-imported', reload);
    return () => {
      observer.disconnect();
      window.removeEventListener('meta-credentials-imported', reload);
    };
  }, []);

  async function load() {
    try {
      const data = await jsonFetch<{ accounts?: CredentialAccount[] }>('/api/credential-vault', { cache: 'no-store' });
      setAccounts(data.accounts || []);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function rename(account: CredentialAccount) {
    const label = window.prompt('T\u00ean hi\u1ec3n th\u1ecb', account.label || account.name);
    if (!label) return;
    setBusy(true); setError('');
    try {
      const data = await jsonFetch<{ message?: string }>('/api/credential-vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename', label, sessionId: account.sessionId, tokenId: account.tokenId }),
      });
      setMessage(data.message || '\u0110\u00e3 s\u1eeda t\u00ean.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(account: CredentialAccount) {
    if (!window.confirm(`X\u00f3a ${account.name || account.label} kh\u1ecfi kho?`)) return;
    setBusy(true); setError('');
    try {
      const data = await jsonFetch<{ message?: string }>('/api/credential-vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          sessionIds: account.sessionId ? [account.sessionId] : [],
          tokenIds: account.tokenId ? [account.tokenId] : [],
        }),
      });
      setMessage(data.message || '\u0110\u00e3 x\u00f3a.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return accounts;
    return accounts.filter((account) => `${account.label} ${account.name} ${account.uid}`.toLowerCase().includes(needle));
  }, [accounts, query]);

  const button = nav ? createPortal(
    <button
      type="button"
      onClick={() => { setOpen(true); void load(); }}
      style={{ height: 38, border: 0, borderRadius: 9, padding: '0 16px', background: open ? '#fff' : 'rgba(255,255,255,.12)', color: open ? '#3f58c9' : '#fff', display: 'flex', alignItems: 'center', gap: 7, fontWeight: 750, fontSize: 12, cursor: 'pointer' }}
    >
      <WalletCards size={14}/> KHO COOKIE/TOKEN
    </button>,
    nav,
  ) : null;

  if (!open) return button;

  return (
    <>
      {button}
      <div style={{ position: 'fixed', inset: 58, background: '#f4f7fb', zIndex: 40, overflow: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: '#6070b8' }}>CREDENTIAL VAULT</div>
            <h2 style={{ margin: '6px 0' }}>Kho cookie / token</h2>
            <p style={{ margin: 0, color: '#6b7488', fontSize: 13 }}>Ch\u1ec9 xem, s\u1eeda t\u00ean v\u00e0 x\u00f3a. Check v\u1eabn l\u00e0m \u1edf T\u1ea1o t\u00e0i nguy\u00ean.</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => void load()} style={{ border: '1px solid #dbe3f0', background: '#fff', borderRadius: 10, padding: '9px 12px', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}><RefreshCw size={14}/> L\u00e0m m\u1edbi</button>
            <button type="button" onClick={() => setOpen(false)} style={{ border: '1px solid #dbe3f0', background: '#fff', borderRadius: 10, padding: '9px 12px', cursor: 'pointer' }}>\u0110\u00f3ng</button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #e2e8f2', borderRadius: 10, padding: '8px 10px', maxWidth: 420, marginBottom: 14 }}>
          <Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="T\u00ecm t\u00ean, UID..." style={{ border: 0, outline: 0, width: '100%', fontSize: 13 }}/>
        </div>
        {message && <div style={{ background: '#edf9f1', color: '#247447', borderRadius: 8, padding: '8px 10px', marginBottom: 10, fontSize: 12 }}>{message}</div>}
        {error && <div style={{ background: '#fff1f2', color: '#b4233c', borderRadius: 8, padding: '8px 10px', marginBottom: 10, fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.length ? rows.map((account) => (
            <div key={account.id} style={{ background: '#fff', border: '1px solid #e4e9f2', borderRadius: 12, padding: '12px 14px', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: 12, alignItems: 'center' }}>
              <div>
                <strong style={{ display: 'block' }}>{account.name}{account.uid ? ` - ${account.uid}` : ''}</strong>
                <small style={{ color: '#6b7488' }}>{account.lastError || account.label} \u00b7 BM {account.businessCount ?? '\u2014'} \u00b7 ADS {account.adAccountCount ?? '\u2014'} \u00b7 Page {account.pageCount ?? '\u2014'}</small>
              </div>
              <span style={{ fontSize: 11, fontWeight: 800 }}>{statusText(account)}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" disabled={busy} onClick={() => void rename(account)} style={{ border: '1px solid #dbe3f0', background: '#fff', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>S\u1eeda</button>
                <button type="button" disabled={busy} onClick={() => void remove(account)} style={{ border: '1px solid #dbe3f0', background: '#fff', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Trash2 size={13}/> X\u00f3a</button>
              </div>
            </div>
          )) : <p style={{ color: '#6b7488' }}>Kho tr\u1ed1ng. N\u1ea1p cookie ho\u1eb7c token \u1edf m\u1ee5c T\u1ea1o t\u00e0i nguy\u00ean.</p>}
        </div>
      </div>
    </>
  );
}
