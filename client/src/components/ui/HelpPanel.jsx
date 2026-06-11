import { useState, useCallback, useRef, useEffect } from 'react';
import { HELP_CATEGORIES, HELP_INDEX } from '../../data/helpContent.js';

/**
 * HelpPanel — slide-in searchable documentation panel.
 * Opened via the ? button in the Topbar.
 */
export default function HelpPanel({ open, onClose }) {
  const [query, setQuery]           = useState('');
  const [activeCategory, setActive] = useState('getting-started');
  const [expandedSection, setExpandedSection] = useState(null);
  const inputRef = useRef(null);

  // Focus search input when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery('');
      setExpandedSection(null);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const searchResults = query.trim().length >= 2
    ? HELP_INDEX.filter(item => item.searchText.includes(query.toLowerCase().trim()))
    : null;

  const activeResults = searchResults
    ? searchResults
    : HELP_INDEX.filter(item => item.categoryId === activeCategory);

  const activeCat = HELP_CATEGORIES.find(c => c.id === activeCategory);

  function handleCategoryClick(id) {
    setActive(id);
    setQuery('');
    setExpandedSection(null);
  }

  function toggleSection(id) {
    setExpandedSection(prev => prev === id ? null : id);
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
          zIndex: 1200, animation: 'fadeIn .15s ease',
        }}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-label="Help & Documentation"
        aria-modal="true"
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 560,
          maxWidth: '95vw',
          background: 'var(--bg-card, #1e1e2e)',
          borderLeft: '1px solid var(--border, #2a2a3a)',
          zIndex: 1201,
          display: 'flex', flexDirection: 'column',
          animation: 'slideInRight .2s cubic-bezier(.4,0,.2,1)',
          boxShadow: '-8px 0 32px rgba(0,0,0,.4)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px 12px',
          borderBottom: '1px solid var(--border, #2a2a3a)',
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        }}>
          <span style={{ fontSize: 20 }}>📖</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Help & Documentation</div>
            <div style={{ fontSize: 11, color: 'var(--muted, #888)', marginTop: 2 }}>
              Search or browse topics below
            </div>
          </div>
          <button
            onClick={onClose}
            title="Close help panel"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--muted, #888)', padding: 4, borderRadius: 4,
              lineHeight: 1, fontSize: 18,
            }}
          >✕</button>
        </div>

        {/* Search */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border, #2a2a3a)', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="var(--muted,#888)" strokeWidth="2" strokeLinecap="round"
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
            >
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search documentation…"
              style={{
                width: '100%', padding: '8px 12px 8px 32px',
                background: 'var(--bg, #12121c)',
                border: '1px solid var(--border, #2a2a3a)',
                borderRadius: 6, color: 'var(--text, #e0e0e0)',
                fontSize: 13, outline: 'none', boxSizing: 'border-box',
              }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--muted,#888)', fontSize: 14, lineHeight: 1, padding: 2,
                }}
              >✕</button>
            )}
          </div>
        </div>

        {/* Body: sidebar + content */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* Category sidebar — hidden during search */}
          {!searchResults && (
            <div style={{
              width: 160, flexShrink: 0,
              borderRight: '1px solid var(--border, #2a2a3a)',
              overflowY: 'auto', padding: '8px 0',
            }}>
              {HELP_CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => handleCategoryClick(cat.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '9px 14px', border: 'none', textAlign: 'left',
                    background: activeCategory === cat.id
                      ? 'rgba(20,146,255,.12)'
                      : 'transparent',
                    color: activeCategory === cat.id
                      ? 'var(--accent, #1492ff)'
                      : 'var(--text, #e0e0e0)',
                    fontSize: 12, cursor: 'pointer',
                    borderRight: activeCategory === cat.id
                      ? '2px solid var(--accent, #1492ff)'
                      : '2px solid transparent',
                    fontWeight: activeCategory === cat.id ? 600 : 400,
                    lineHeight: 1.3,
                  }}
                >
                  <span style={{ fontSize: 14 }}>{cat.icon}</span>
                  <span>{cat.title}</span>
                </button>
              ))}
            </div>
          )}

          {/* Content area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

            {/* Search results header */}
            {searchResults && (
              <div style={{ marginBottom: 16 }}>
                <span style={{ fontSize: 12, color: 'var(--muted,#888)' }}>
                  {searchResults.length === 0
                    ? 'No results found'
                    : `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''} for "${query}"`}
                </span>
              </div>
            )}

            {/* Category heading (when browsing) */}
            {!searchResults && activeCat && (
              <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 22 }}>{activeCat.icon}</span>
                <span style={{ fontWeight: 700, fontSize: 16 }}>{activeCat.title}</span>
              </div>
            )}

            {/* Sections */}
            {activeResults.length === 0 && searchResults && (
              <div style={{
                textAlign: 'center', padding: '48px 24px',
                color: 'var(--muted,#888)', fontSize: 13,
              }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
                <div>No results found for <strong>"{query}"</strong></div>
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  Try different keywords or browse by category
                </div>
              </div>
            )}

            {activeResults.map(item => {
              const sectionKey = item.sectionId;
              const isExpanded = expandedSection === sectionKey;
              return (
                <div
                  key={sectionKey}
                  style={{
                    marginBottom: 8,
                    border: '1px solid var(--border, #2a2a3a)',
                    borderRadius: 8,
                    overflow: 'hidden',
                  }}
                >
                  {/* Section header */}
                  <button
                    onClick={() => toggleSection(sectionKey)}
                    style={{
                      width: '100%', textAlign: 'left', padding: '11px 14px',
                      background: isExpanded ? 'rgba(20,146,255,.08)' : 'var(--bg, #12121c)',
                      border: 'none', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text,#e0e0e0)' }}>
                        {item.sectionTitle}
                      </div>
                      {searchResults && (
                        <div style={{ fontSize: 11, color: 'var(--muted,#888)', marginTop: 2 }}>
                          {item.categoryIcon} {item.categoryTitle}
                        </div>
                      )}
                    </div>
                    <svg
                      width="12" height="12" viewBox="0 0 24 24" fill="currentColor"
                      style={{
                        flexShrink: 0, opacity: .6,
                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform .2s',
                        color: 'var(--muted,#888)',
                      }}
                    >
                      <path d="M7 10l5 5 5-5z"/>
                    </svg>
                  </button>

                  {/* Section content */}
                  {isExpanded && (
                    <div style={{
                      padding: '12px 14px 14px',
                      background: 'var(--bg-card, #1e1e2e)',
                      borderTop: '1px solid var(--border, #2a2a3a)',
                    }}>
                      <HelpContent content={item.content} query={query} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 20px',
          borderTop: '1px solid var(--border,#2a2a3a)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, fontSize: 11, color: 'var(--muted,#888)',
        }}>
          <span>AV Dashboard Documentation</span>
          <a
            href="/docs/user-manual.html"
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--accent,#1492ff)', textDecoration: 'none', fontSize: 11 }}
          >
            Full Manual ↗
          </a>
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </>
  );
}

/** Renders help content with highlight on search terms and bullet formatting */
function HelpContent({ content, query }) {
  const lines = content.split('\n');
  const highlight = query.trim().length >= 2 ? query.trim().toLowerCase() : null;

  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.7, color: 'var(--text,#e0e0e0)' }}>
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} style={{ height: 6 }} />;
        const isBullet = line.startsWith('•') || line.startsWith('→');
        return (
          <div
            key={i}
            style={{
              paddingLeft: isBullet ? 0 : 0,
              fontFamily: line.match(/^\s{2,}/) ? 'monospace' : 'inherit',
              fontSize: line.match(/^\s{2,}/) ? 12 : 12.5,
              color: line.match(/^\s{2,}/) ? 'var(--muted,#888)' : 'var(--text,#e0e0e0)',
              marginBottom: 2,
            }}
          >
            <HighlightedText text={line} highlight={highlight} />
          </div>
        );
      })}
    </div>
  );
}

function HighlightedText({ text, highlight }) {
  if (!highlight) return <>{text}</>;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(highlight);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: 'rgba(255,210,0,.25)', color: 'inherit', borderRadius: 2, padding: '0 1px' }}>
        {text.slice(idx, idx + highlight.length)}
      </mark>
      <HighlightedText text={text.slice(idx + highlight.length)} highlight={highlight} />
    </>
  );
}
