import { useState, useEffect, useRef } from 'react';
import useStore from '../store/useStore.js';

async function tfsLogin(username, pat) {
  const res = await fetch('/api/auth/tfs-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, ...(pat ? { pat } : {}) }),
  });
  return res;
}

async function checkUserHasPat(username) {
  try {
    const res = await fetch(`/api/auth/tfs-check-user?username=${encodeURIComponent(username)}`);
    if (!res.ok) return false;
    const d = await res.json();
    return d.hasPat === true;
  } catch { return false; }
}

export default function LoginPage({ error, authMode }) {
  const branding = useStore(s => s.branding);
  const appName  = branding?.appName || 'AV Dashboard';
  const isTfs    = authMode === 'tfs';

  const [username,     setUsername]     = useState('');
  const [pat,          setPat]          = useState('');
  const [loading,      setLoading]      = useState(false);
  const [tfsError,     setTfsError]     = useState('');
  const [hasStoredPat, setHasStoredPat] = useState(null); // null=unknown, true, false
  const [patExpired,   setPatExpired]   = useState(false);
  const debounceRef = useRef(null);

  // When username changes, debounce-check if a stored PAT exists
  useEffect(() => {
    if (!isTfs) return;
    setHasStoredPat(null);
    setPatExpired(false);
    setPat('');
    clearTimeout(debounceRef.current);
    const trimmed = username.trim();
    if (!trimmed) return;
    debounceRef.current = setTimeout(async () => {
      const stored = await checkUserHasPat(trimmed);
      setHasStoredPat(stored);
    }, 400);
  }, [username, isTfs]);

  const showPatField = hasStoredPat === false || patExpired;

  const errorMsg = tfsError
    || (error === 'failed'       ? 'Authentication failed. Please try again.'
      : error === 'unconfigured' ? 'Azure AD is not configured. Contact your admin.'
      : error === 'error'        ? 'An error occurred. Please try again.'
      : null);

  async function handleTfsSubmit(e) {
    e.preventDefault();
    if (showPatField && !pat.trim()) { setTfsError('PAT is required'); return; }
    setLoading(true);
    setTfsError('');
    try {
      const res = await tfsLogin(username.trim(), showPatField ? pat.trim() : null);
      if (res.ok) {
        window.location.href = '/';
      } else {
        const d = await res.json().catch(() => ({}));
        if (d.error === 'PAT_EXPIRED') {
          setPatExpired(true);
          setHasStoredPat(false);
          setTfsError('Your stored PAT has expired. Please enter a new one.');
        } else {
          setTfsError(d.error || 'Login failed. Check your credentials and try again.');
        }
      }
    } catch {
      setTfsError('Cannot reach server. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const inp = {
    width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #333',
    color: '#fff', fontSize: 13, boxSizing: 'border-box', outline: 'none',
  };

  return (
    <div style={{
      minHeight: '100vh', minWidth: '100vw', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0d0d0d',
    }}>
      <div style={{
        background: '#1a1a1a', border: '1px solid #2a2a2a',
        padding: '48px 40px', width: 380, textAlign: 'center',
      }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>🏆</div>
        <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>
          {appName}
        </h1>
        <p style={{ color: '#888', fontSize: 13, marginBottom: 32, marginTop: 0 }}>
          {isTfs ? 'Sign in with your TFS credentials' : 'Sign in with your Microsoft account to continue'}
        </p>

        {errorMsg && (
          <div style={{
            background: 'rgba(235,63,63,.12)', border: '1px solid #eb3f3f55',
            color: '#eb3f3f', padding: '10px 14px', marginBottom: 20, fontSize: 12, textAlign: 'left',
          }}>
            {errorMsg}
          </div>
        )}

        {isTfs ? (
          <form onSubmit={handleTfsSubmit} style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Username */}
            <div>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 5 }}>
                Username <span style={{ color: '#555', fontWeight: 400 }}>(e.g. DOMAIN\user or email)</span>
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="DOMAIN\username or email@company.com"
                autoFocus
                autoComplete="username"
                style={inp}
              />
            </div>

            {/* PAT field — first-time or expired */}
            {showPatField && (
              <div>
                <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 5 }}>
                  Personal Access Token (PAT) <span style={{ color: '#eb3f3f' }}>*</span>
                </label>
                <input
                  type="password"
                  value={pat}
                  onChange={e => setPat(e.target.value)}
                  placeholder="Paste your TFS PAT here"
                  autoComplete="current-password"
                  style={inp}
                />
                {/* Storage notice */}
                {!patExpired && hasStoredPat === false && username.trim() && (
                  <p style={{
                    marginTop: 8, marginBottom: 0, fontSize: 11,
                    color: '#888', lineHeight: 1.5,
                    background: 'rgba(0,120,212,.08)', border: '1px solid rgba(0,120,212,.2)',
                    padding: '8px 10px',
                  }}>
                    🔒 Your PAT will be stored securely on this server so you only need your username next time.
                  </p>
                )}
              </div>
            )}

            {/* Checking indicator */}
            {username.trim() && hasStoredPat === null && (
              <p style={{ fontSize: 11, color: '#555', margin: 0 }}>Checking account…</p>
            )}

            <button
              type="submit"
              disabled={loading || !username.trim() || (showPatField && !pat.trim())}
              style={{
                width: '100%', padding: '13px 24px',
                background: loading ? '#555' : '#0078d4',
                color: '#fff', border: 'none',
                cursor: loading ? 'default' : 'pointer',
                fontWeight: 600, fontSize: 14, marginTop: 4,
                opacity: (!username.trim() || (showPatField && !pat.trim())) ? 0.6 : 1,
              }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>

            <p style={{ color: '#444', fontSize: 11, margin: 0, textAlign: 'center' }}>
              Secured via TFS Personal Access Token
            </p>
          </form>
        ) : (
          <>
            <a
              href="/api/auth/login"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                background: '#0078d4', color: '#fff', padding: '13px 24px',
                textDecoration: 'none', fontWeight: 600, fontSize: 14,
                border: 'none', cursor: 'pointer', width: '100%', boxSizing: 'border-box',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="0"  y="0"  width="10" height="10" fill="#f25022"/>
                <rect x="11" y="0"  width="10" height="10" fill="#7fba00"/>
                <rect x="0"  y="11" width="10" height="10" fill="#00a4ef"/>
                <rect x="11" y="11" width="10" height="10" fill="#ffb900"/>
              </svg>
              Sign in with Microsoft
            </a>
            <p style={{ color: '#555', fontSize: 11, marginTop: 24, marginBottom: 0 }}>
              Secured via Azure Active Directory
            </p>
          </>
        )}
      </div>
    </div>
  );
}
