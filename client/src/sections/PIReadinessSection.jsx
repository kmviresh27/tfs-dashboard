import { useState } from 'react';
import useStore from '../store/useStore.js';
import { usePIReadiness } from '../api/hooks.js';
import { PageLoader } from '../components/ui/PageLoader.jsx';

const CHECK_ICONS = {
  estimate:         '📏',
  stories:          '📋',
  'not-forecasted': '🔮',
  sprint:           '📅',
  assigned:         '👤',
  'story-estimate': '🔢',
};

function ragColor(pct) {
  if (pct >= 80) return '#068443';
  if (pct >= 50) return '#f59e0b';
  return '#ef4444';
}

function ScoreRing({ score, size = 80 }) {
  const r    = (size / 2) - 8;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = ragColor(score);
  return (
    <svg width={size} height={size} style={{ display: 'block', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#333" strokeWidth={7} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={7}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x={size / 2} y={size / 2 + 5} textAnchor="middle" fill={color}
        fontSize={size < 50 ? 12 : 16} fontWeight={700}>{score}</text>
    </svg>
  );
}

// ── Shared Modal shell ────────────────────────────────────────────────────────
function Modal({ onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
      zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--surface-1)', border: '1px solid var(--border)',
        width: '90vw', maxWidth: 780, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        {children}
      </div>
    </div>
  );
}

export default function PIReadinessSection() {
  const selectedPIs  = useStore(s => s.selectedPIs);
  const currentPI    = useStore(s => s.currentPI);
  const tfsBaseUrl   = useStore(s => s.tfsBaseUrl);
  const selectedTeam = useStore(s => s.selectedTeam);

  const pis = selectedPIs.length ? selectedPIs : (currentPI ? [currentPI] : []);
  const singleTeam = !!(selectedTeam && selectedTeam.trim());

  const { data, isLoading, error } = usePIReadiness(pis, selectedTeam || undefined);

  // popup state — only used in multi-team view
  const [teamPopup,  setTeamPopup]  = useState(null);
  const [checkPopup, setCheckPopup] = useState(null);
  // single-team: which check row is expanded
  const [expandedCheck, setExpandedCheck] = useState(null);

  if (isLoading) return <PageLoader />;
  if (error) return <div style={{ padding: 24, color: '#ef4444' }}>Error: {error.message}</div>;
  if (!data) return <div style={{ padding: 24, color: 'var(--muted)' }}>Select a PI to check readiness.</div>;

  const { programmeScore, totalFeatures, teams, checkLabels } = data;

  const teamPopupEntry  = teamPopup  ? teams.find(t => t.team === teamPopup)   : null;
  const checkTeamEntry  = checkPopup ? teams.find(t => t.team === checkPopup.team) : null;
  const checkEntry      = checkTeamEntry?.criteria.find(c => c.id === checkPopup?.checkId);

  // ── SINGLE-TEAM DETAILED VIEW ─────────────────────────────────────────────
  if (singleTeam) {
    const teamEntry  = teams.length > 0 ? teams[0] : null;
    const teamName   = selectedTeam.split('\\').pop();
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 18 }}>🎯 PI Readiness</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {pis.join(', ')} · <strong style={{ color: 'var(--text)' }}>👥 {teamName}</strong>
          </span>
          {!teamEntry && (
            <span style={{ fontSize: 12, color: '#f59e0b' }}>⚠ No features found for this team in selected PI</span>
          )}
        </div>

        {teamEntry && (
          <>
            {/* Score hero */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 24, marginBottom: 24,
              background: 'var(--surface-1)', padding: '20px 28px', flexWrap: 'wrap',
              borderLeft: `6px solid ${ragColor(teamEntry.score)}`,
              border: `1px solid ${ragColor(teamEntry.score)}44`,
            }}>
              <ScoreRing score={teamEntry.score} size={88} />
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Team Readiness Score</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: ragColor(teamEntry.score) }}>
                  {teamEntry.score >= 80 ? '✅ Ready' : teamEntry.score >= 50 ? '⚠ Needs Attention' : '🔴 Not Ready'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  {teamEntry.totalFeatures} features · {(checkLabels || []).length} criteria checked
                </div>
              </div>
            </div>

            {/* Criteria — expandable inline */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {teamEntry.criteria.map(c => {
                const open = expandedCheck === c.id;
                return (
                  <div key={c.id} style={{
                    border: `1px solid ${c.fail > 0 ? ragColor(c.pct) + '44' : '#06844333'}`,
                    background: 'var(--bg-card)',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
                      cursor: c.fail > 0 ? 'pointer' : 'default',
                    }} onClick={() => c.fail > 0 && setExpandedCheck(open ? null : c.id)}>
                      <span style={{ fontSize: 16 }}>{CHECK_ICONS[c.id]}</span>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{c.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 8 }}>{c.pass} ok · {c.fail} fail</span>
                      <div style={{ width: 120, height: 8, background: 'var(--surface-2)', flexShrink: 0 }}>
                        <div style={{ width: `${c.pct}%`, height: '100%', background: ragColor(c.pct), transition: 'width 0.4s' }} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: ragColor(c.pct), width: 42, textAlign: 'right' }}>{c.pct}%</span>
                      {c.fail > 0
                        ? <span style={{ fontSize: 11, color: 'var(--muted)', width: 12 }}>{open ? '▲' : '▼'}</span>
                        : <span style={{ fontSize: 14, color: '#068443', width: 12 }}>✓</span>
                      }
                    </div>
                    {open && c.failItems?.length > 0 && (
                      <div style={{ borderTop: '1px solid var(--border)', overflowX: 'auto' }}>
                        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                          <thead>
                            <tr style={{ background: 'var(--surface-2)' }}>
                              {['ID', 'Title', 'State', 'Assigned To'].map(h => (
                                <th key={h} style={{ padding: '7px 12px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {c.failItems.map(fi => (
                              <tr key={fi.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
                                  {tfsBaseUrl
                                    ? <a href={`${tfsBaseUrl}/_workitems/edit/${fi.id}`} target="_blank" rel="noreferrer" style={{ color: '#1492ff', fontFamily: 'monospace', fontSize: 11 }}>#{fi.id}</a>
                                    : <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#1492ff' }}>#{fi.id}</span>}
                                </td>
                                <td style={{ padding: '7px 12px' }}>{fi.title}</td>
                                <td style={{ padding: '7px 12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fi.state}</td>
                                <td style={{ padding: '7px 12px', color: 'var(--muted)' }}>{fi.assignedTo || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── MULTI-TEAM PROGRAMME VIEW ─────────────────────────────────────────────
  return (
    <div>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 18 }}>🎯 Pre-PI Planning Readiness</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{pis.join(', ')} · {totalFeatures} features</span>
      </div>

      {/* ── Programme Score Hero ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 24, marginBottom: 28,
        background: 'var(--surface-1)', padding: '20px 28px', flexWrap: 'wrap',
        borderLeft: `6px solid ${ragColor(programmeScore)}`,
        border: `1px solid ${ragColor(programmeScore)}44`,
      }}>
        <ScoreRing score={programmeScore} size={88} />
        <div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Programme Readiness Score</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: ragColor(programmeScore) }}>
            {programmeScore >= 80 ? '✅ Ready' : programmeScore >= 50 ? '⚠ Needs Attention' : '🔴 Not Ready'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {(checkLabels || []).length} criteria · {teams.length} teams · {totalFeatures} features
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { label: `${teams.filter(t => t.score >= 80).length} teams ready`,          color: '#068443' },
            { label: `${teams.filter(t => t.score >= 50 && t.score < 80).length} need attention`, color: '#f59e0b' },
            { label: `${teams.filter(t => t.score < 50).length} not ready`,             color: '#ef4444' },
          ].map(p => (
            <span key={p.label} style={{
              fontSize: 10, padding: '2px 10px', borderRadius: 10,
              background: `${p.color}22`, color: p.color, border: `1px solid ${p.color}44`,
            }}>{p.label}</span>
          ))}
        </div>
      </div>

      {/* ── Criteria Heatmap — full width ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>
          📊 Criteria Heatmap
          <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)', marginLeft: 10 }}>
            click team name → breakdown · click cell → failing items
          </span>
        </div>
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 500 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)', position: 'sticky', top: 0, zIndex: 2, boxShadow: '0 2px 0 var(--border)' }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600, minWidth: 140 }}>Team</th>
                <th style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--muted)', fontWeight: 600, minWidth: 70 }}>Score</th>
                {(checkLabels || []).map(c => (
                  <th key={c.id} style={{
                    padding: '10px 8px', textAlign: 'center', color: 'var(--muted)',
                    fontWeight: 600,
                    width: `${Math.floor((100 - 20 - 10) / Math.max(1, (checkLabels || []).length))}%`,
                  }}>
                    <div style={{ fontSize: 9 }} title={c.label}>
                      {c.label.length > 16 ? c.label.slice(0, 16) + '…' : c.label}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teams.map((t, ri) => (
                <tr key={t.team} style={{
                  borderBottom: '1px solid var(--border)',
                  background: ri % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                }}>
                  {/* Team name — opens breakdown popup */}
                  <td style={{ padding: '10px 14px' }}>
                    <button
                      onClick={() => setTeamPopup(t.team)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#1492ff', fontSize: 12, fontWeight: 600,
                        textAlign: 'left', padding: 0, textDecoration: 'underline dotted',
                      }}
                      title="Click to see readiness breakdown"
                    >
                      {t.team}
                    </button>
                  </td>

                  {/* Score pill */}
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
                      background: `${ragColor(t.score)}22`, color: ragColor(t.score),
                      border: `1px solid ${ragColor(t.score)}44`,
                    }}>{t.score}%</span>
                  </td>

                  {/* Criteria cells — open failing items popup */}
                  {t.criteria.map(c => (
                    <td key={c.id} style={{ padding: '6px 8px', textAlign: 'center' }}>
                      <button
                        onClick={() => c.fail > 0 && setCheckPopup({ team: t.team, checkId: c.id })}
                        title={`${c.label}: ${c.pass} pass, ${c.fail} fail (${c.pct}%)`}
                        style={{
                          width: '100%', minWidth: 40, height: 32, borderRadius: 4,
                          border: c.fail > 0 ? `1px solid ${ragColor(c.pct)}44` : '1px solid #06844344',
                          cursor: c.fail > 0 ? 'pointer' : 'default',
                          background: c.fail === 0 ? '#06844318' : c.pct >= 50 ? '#f59e0b18' : '#ef444418',
                          color: c.fail === 0 ? '#068443' : c.pct >= 50 ? '#f59e0b' : '#ef4444',
                          fontWeight: 700, fontSize: 12,
                          transition: 'filter 0.15s',
                        }}
                        onMouseEnter={e => { if (c.fail > 0) e.currentTarget.style.filter = 'brightness(1.3)'; }}
                        onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
                      >
                        {c.fail > 0 ? c.fail : '✓'}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Legend ── */}
      <div style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ color: '#068443' }}>✓ / ✅ ≥80% — Ready</span>
        <span style={{ color: '#f59e0b' }}>⚠ 50-79% — Needs Attention</span>
        <span style={{ color: '#ef4444' }}>🔴 &lt;50% — Not Ready</span>
        <span>Cell number = failing features count</span>
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          POPUP 1 — Team Readiness Breakdown
      ════════════════════════════════════════════════════════════════════════ */}
      {teamPopupEntry && (
        <Modal onClose={() => setTeamPopup(null)}>
          {/* Fixed Header */}
          <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 16 }}>
            <ScoreRing score={teamPopupEntry.score} size={64} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Readiness Breakdown</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>👥 {teamPopupEntry.team}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                {teamPopupEntry.totalFeatures} features
              </div>
            </div>
            <button onClick={() => setTeamPopup(null)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--muted)', fontSize: 20, lineHeight: 1,
            }}>✕</button>
          </div>

          {/* Scrollable body */}
          <div style={{ overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {teamPopupEntry.criteria.map(c => (
              <div key={c.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13 }}>{CHECK_ICONS[c.id]}</span>
                  <span style={{ flex: 1, fontSize: 12 }}>{c.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: ragColor(c.pct) }}>{c.pct}%</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)', width: 90, textAlign: 'right' }}>
                    {c.pass} ok · {c.fail} fail
                  </span>
                  {c.fail > 0 && (
                    <button
                      onClick={() => { setTeamPopup(null); setCheckPopup({ team: teamPopupEntry.team, checkId: c.id }); }}
                      style={{
                        fontSize: 10, padding: '2px 8px', borderRadius: 4,
                        background: `${ragColor(c.pct)}22`, color: ragColor(c.pct),
                        border: `1px solid ${ragColor(c.pct)}44`, cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >See {c.fail} items →</button>
                  )}
                </div>
                <div style={{ height: 12, background: 'var(--surface-2)', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{
                    width: `${c.pct}%`, height: '100%',
                    background: ragColor(c.pct), borderRadius: 6,
                    transition: 'width 0.4s ease',
                  }} />
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          POPUP 2 — Failing Features for a check
      ════════════════════════════════════════════════════════════════════════ */}
      {checkPopup && checkEntry && (
        <Modal onClose={() => setCheckPopup(null)}>
          {/* Fixed Header */}
          <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Failing features · {checkPopup.team}</div>
              <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>
                {CHECK_ICONS[checkPopup.checkId]} {checkEntry.label}
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                <span style={{ fontSize: 11, color: '#ef4444' }}>❌ {checkEntry.fail} failing</span>
                <span style={{ fontSize: 11, color: '#068443' }}>✅ {checkEntry.pass} passing</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: ragColor(checkEntry.pct) }}>{checkEntry.pct}%</span>
              </div>
            </div>
            <button onClick={() => setCheckPopup(null)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--muted)', fontSize: 20, lineHeight: 1, flexShrink: 0,
            }}>✕</button>
          </div>

          {/* Scrollable body */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
          {checkEntry.failItems?.length ? (
            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)' }}>
                  {['ID', 'Title', 'State', 'Assigned To'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600, borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface-2)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {checkEntry.failItems.map(fi => (
                  <tr key={fi.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                      {tfsBaseUrl
                        ? <a href={`${tfsBaseUrl}/_workitems/edit/${fi.id}`} target="_blank" rel="noreferrer"
                            style={{ color: '#1492ff', fontFamily: 'Consolas,monospace', fontSize: 11 }}>#{fi.id}</a>
                        : <span style={{ fontFamily: 'Consolas,monospace', fontSize: 11, color: '#1492ff' }}>#{fi.id}</span>
                      }
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--text)' }}>{fi.title}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fi.state}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>{fi.assignedTo || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
              All features pass this check ✅
            </div>
          )}
          </div>
        </Modal>
      )}
    </div>
  );
}

