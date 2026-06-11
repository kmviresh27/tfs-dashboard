import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import useStore from '../../store/useStore.js';
import { apiFetch } from '../../api/apiClient.js';

const STEPS = ['Welcome', 'TFS URL', 'PAT', 'Paths', 'Done'];

const S = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  box:     { background: '#2B2B2B', borderRadius: 0, padding: 32, width: 480, maxWidth: '90vw', border: '1px solid #454545', boxShadow: '0 20px 60px rgba(0,0,0,.5)' },
  h2:      { margin: '0 0 8px', color: '#fff', fontSize: 20, fontWeight: 700 },
  p:       { margin: '0 0 24px', color: '#ADADAD', fontSize: 14 },
  label:   { display: 'block', marginBottom: 6, color: '#ADADAD', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' },
  input:   { width: '100%', padding: '10px 12px', background: '#1a1a1a', border: '1px solid #454545', borderRadius: 0, color: '#fff', fontSize: 14, boxSizing: 'border-box', marginBottom: 16, outline: 'none' },
  row:     { display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' },
  btn:     { padding: '10px 20px', borderRadius: 0, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  primary: { padding: '10px 20px', borderRadius: 0, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, background: '#1492ff', color: '#fff' },
  ghost:   { padding: '10px 20px', borderRadius: 0, border: '1px solid #454545', cursor: 'pointer', fontSize: 14, fontWeight: 600, background: 'transparent', color: '#ADADAD' },
};

export default function ConfigWizard({ onClose }) {
  const queryClient = useQueryClient();
  const branding = useStore(s => s.branding);
  const [step, setStep]   = useState(1);
  const [form, setForm]   = useState({ baseUrl: '', pat: '', areaPath: '', iterationPath: '' });
  const [status, setStatus] = useState('');
  const [busy, setBusy]   = useState(false);

  function update(field, value) {
    setForm(f => ({ ...f, [field]: value }));
    setStatus('');
  }

  async function testConnection() {
    setBusy(true);
    setStatus('');
    try {
      await apiFetch('/api/test-connection', {
        method: 'POST',
        body: JSON.stringify({ baseUrl: form.baseUrl, pat: form.pat }),
      });
      setStatus('✅ Connection successful!');
    } catch (e) {
      setStatus(`❌ ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setStatus('');
    try {
      await apiFetch('/api/config', {
        method: 'POST',
        body: JSON.stringify({
          tfs: { baseUrl: form.baseUrl, pat: form.pat, areaPath: form.areaPath, iterationPath: form.iterationPath },
        }),
      });
      setStep(5);
    } catch (e) {
      setStatus(`❌ ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    queryClient.invalidateQueries();
    onClose();
  }

  const statusColor = status.startsWith('✅') ? '#068443' : '#eb3f3f';

  return (
    <div style={S.overlay}>
      <div style={S.box}>
        {/* Progress bar */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{ height: 4, flex: 1, borderRadius: 0, background: i + 1 <= step ? '#1492ff' : '#454545' }} />
          ))}
        </div>

        {step === 1 && (
          <>
            <h2 style={S.h2}>👋 Welcome to {branding?.appName || 'the Dashboard'}!</h2>
            <p style={S.p}>Let's connect to TFS. This wizard will guide you through the initial setup in a few quick steps.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button style={S.primary} onClick={() => setStep(2)}>Get Started →</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 style={S.h2}>🔗 TFS Base URL</h2>
            <p style={S.p}>Enter the base URL of your TFS / Azure DevOps Server instance.</p>
            <label style={S.label}>TFS Base URL</label>
            <input style={S.input} type="url" placeholder="https://tfs.example.com/tfs"
              value={form.baseUrl} onChange={e => update('baseUrl', e.target.value)} />
            {status && <div style={{ marginBottom: 12, fontSize: 13, color: statusColor }}>{status}</div>}
            <div style={S.row}>
              <button style={S.ghost} onClick={() => setStep(1)}>← Back</button>
              <button style={S.primary} disabled={!form.baseUrl} onClick={() => setStep(3)}>Next →</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2 style={S.h2}>🔑 Personal Access Token</h2>
            <p style={S.p}>Enter a PAT with at least <em>Read</em> access to Work Items and Code.</p>
            <label style={S.label}>Personal Access Token</label>
            <input style={S.input} type="password" placeholder="••••••••••••••••"
              value={form.pat} onChange={e => update('pat', e.target.value)} />
            {status && <div style={{ marginBottom: 12, fontSize: 13, color: statusColor }}>{status}</div>}
            <div style={S.row}>
              <button style={S.ghost} onClick={() => setStep(2)}>← Back</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={S.ghost} disabled={busy || !form.pat} onClick={testConnection}>
                  {busy ? 'Testing…' : 'Test Connection'}
                </button>
                <button style={S.primary} disabled={!form.pat} onClick={() => setStep(4)}>Next →</button>
              </div>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2 style={S.h2}>📁 Area &amp; Iteration Paths</h2>
            <p style={S.p}>Set the TFS area path and iteration path for your programme.</p>
            <label style={S.label}>Area Path</label>
            <input style={S.input} type="text" placeholder="Project\\Team"
              value={form.areaPath} onChange={e => update('areaPath', e.target.value)} />
            <label style={S.label}>Iteration Path</label>
            <input style={S.input} type="text" placeholder="Project\\PI"
              value={form.iterationPath} onChange={e => update('iterationPath', e.target.value)} />
            {status && <div style={{ marginBottom: 12, fontSize: 13, color: statusColor }}>{status}</div>}
            <div style={S.row}>
              <button style={S.ghost} onClick={() => setStep(3)}>← Back</button>
              <button style={S.primary} disabled={busy} onClick={save}>
                {busy ? 'Saving…' : 'Save & Continue'}
              </button>
            </div>
          </>
        )}

        {step === 5 && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <h2 style={{ ...S.h2, textAlign: 'center' }}>Connected!</h2>
            <p style={{ ...S.p, textAlign: 'center' }}>Loading {branding?.appName || 'Dashboard'}…</p>
            <button style={S.primary} onClick={finish}>Open Dashboard</button>
          </div>
        )}
      </div>
    </div>
  );
}
