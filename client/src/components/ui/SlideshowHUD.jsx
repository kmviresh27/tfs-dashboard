import { useState, useEffect, useRef } from 'react';
import useStore from '../../store/useStore.js';
import { NAV_ITEMS } from '../../constants.js';

const HIDE_DELAY_MS = 3500;

export default function SlideshowHUD() {
  const slideshowRunning    = useStore(s => s.slideshowRunning);
  const setSlideshowRunning = useStore(s => s.setSlideshowRunning);
  const slideshowInterval   = useStore(s => s.slideshowInterval);
  const slideshowSections   = useStore(s => s.slideshowSections);
  const activeSection       = useStore(s => s.activeSection);
  const slideshowPage       = useStore(s => s.slideshowPage);
  const slideshowTotalPages = useStore(s => s.slideshowTotalPages);

  const [visible, setVisible]     = useState(true);
  const [countdown, setCountdown] = useState(0);
  const hideTimerRef = useRef(null);
  const cdRef        = useRef(0);

  // Show HUD on any user activity; auto-hide after HIDE_DELAY_MS
  useEffect(() => {
    if (!slideshowRunning) return;

    function revealHUD() {
      setVisible(true);
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setVisible(false), HIDE_DELAY_MS);
    }

    revealHUD(); // show on section/page change
    window.addEventListener('pointermove', revealHUD);
    window.addEventListener('pointerdown', revealHUD);
    window.addEventListener('keydown',     revealHUD);
    window.addEventListener('wheel',       revealHUD, { passive: true });

    return () => {
      window.removeEventListener('pointermove', revealHUD);
      window.removeEventListener('pointerdown', revealHUD);
      window.removeEventListener('keydown',     revealHUD);
      window.removeEventListener('wheel',       revealHUD);
      clearTimeout(hideTimerRef.current);
    };
  }, [slideshowRunning, activeSection, slideshowPage]);

  // Countdown timer — resets on each section or page change
  useEffect(() => {
    if (!slideshowRunning) { setCountdown(0); return; }
    cdRef.current = slideshowInterval;
    setCountdown(slideshowInterval);
    const t = setInterval(() => {
      cdRef.current = Math.max(0, cdRef.current - 1);
      setCountdown(cdRef.current);
    }, 1000);
    return () => clearInterval(t);
  }, [slideshowRunning, slideshowInterval, activeSection, slideshowPage]);

  // Exit fullscreen when slideshow is stopped
  useEffect(() => {
    if (!slideshowRunning && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }, [slideshowRunning]);

  // Stop slideshow if user exits fullscreen (e.g., presses browser Esc)
  useEffect(() => {
    function handleFsChange() {
      if (!document.fullscreenElement && slideshowRunning) {
        setSlideshowRunning(false);
      }
    }
    document.addEventListener('fullscreenchange',       handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange',       handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
    };
  }, [slideshowRunning, setSlideshowRunning]);

  if (!slideshowRunning) return null;

  const navItem      = NAV_ITEMS.find(n => n.id === activeSection);
  const sectionLabel = navItem?.label || activeSection;
  const sectionIcon  = navItem?.icon  || '📊';
  const sectionIdx   = slideshowSections.indexOf(activeSection);
  const sectionNum   = sectionIdx + 1;
  const sectionTotal = slideshowSections.length;
  const pageNum      = slideshowPage + 1;

  return (
    <div
      aria-hidden={!visible}
      style={{
        position:     'fixed',
        bottom:       0,
        left:         0,
        right:        0,
        zIndex:       9999,
        opacity:      visible ? 1 : 0,
        transform:    visible ? 'translateY(0)' : 'translateY(8px)',
        transition:   'opacity 0.4s ease, transform 0.4s ease',
        pointerEvents: visible ? 'auto' : 'none',
        userSelect:   'none',
      }}
    >
      <div style={{
        position:         'relative',
        background:       'rgba(8, 10, 20, 0.90)',
        backdropFilter:   'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop:        '1px solid rgba(255,255,255,0.07)',
        display:          'flex',
        alignItems:       'center',
        padding:          '10px 28px',
        gap:              16,
        minHeight:        54,
      }}>

        {/* Full-width progress bar — CSS animation, key resets it on each slide advance */}
        <div
          key={`${activeSection}-${slideshowPage}`}
          style={{
            position:   'absolute',
            top:        0,
            left:       0,
            height:     3,
            background: 'var(--primary, #1492ff)',
            animation:  `hud-progress ${slideshowInterval}s linear forwards`,
          }}
        />

        {/* LEFT: section icon + name + page indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '0 0 auto', minWidth: 200 }}>
          <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{sectionIcon}</span>
          <div>
            <div style={{
              fontSize:      17,
              fontWeight:    700,
              color:         '#fff',
              lineHeight:    1.2,
              letterSpacing: '-.01em',
            }}>
              {sectionLabel}
            </div>
            {slideshowTotalPages > 1 && (
              <div style={{
                fontSize:           11,
                color:              'rgba(255,255,255,.45)',
                marginTop:          2,
                fontVariantNumeric: 'tabular-nums',
              }}>
                Page {pageNum} of {slideshowTotalPages}
              </div>
            )}
          </div>
        </div>

        {/* CENTER: section progress pills */}
        <div style={{
          flex:           1,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          gap:            6,
          overflow:       'hidden',
        }}>
          {slideshowSections.map((sec, i) => {
            const isActive = i === sectionIdx;
            const isPast   = i < sectionIdx;
            return (
              <div
                key={sec}
                title={NAV_ITEMS.find(n => n.id === sec)?.label || sec}
                style={{
                  flexShrink: 0,
                  width:      isActive ? 28 : 8,
                  height:     8,
                  borderRadius: 4,
                  background: isActive
                    ? 'var(--primary, #1492ff)'
                    : isPast
                    ? 'rgba(255,255,255,.38)'
                    : 'rgba(255,255,255,.13)',
                  transition: 'width 0.3s ease, background 0.3s ease',
                }}
              />
            );
          })}
          <span style={{
            flexShrink:         0,
            marginLeft:         10,
            fontSize:           12,
            color:              'rgba(255,255,255,.5)',
            fontWeight:         600,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {sectionNum}&thinsp;/&thinsp;{sectionTotal}
          </span>
        </div>

        {/* RIGHT: countdown + stop button */}
        <div style={{
          display:        'flex',
          alignItems:     'center',
          gap:            12,
          flex:           '0 0 auto',
          minWidth:       120,
          justifyContent: 'flex-end',
        }}>
          <div style={{
            fontSize:           22,
            fontWeight:         800,
            color:              countdown <= 3 ? '#f87171' : 'rgba(255,255,255,.55)',
            fontVariantNumeric: 'tabular-nums',
            minWidth:           40,
            textAlign:          'right',
            transition:         'color 0.2s',
          }}>
            {countdown}s
          </div>

          <button
            onClick={() => setSlideshowRunning(false)}
            title="Stop slideshow (Esc)"
            aria-label="Stop slideshow"
            style={{
              width:        40,
              height:       40,
              border:       '2px solid rgba(248,113,113,.5)',
              background:   'rgba(248,113,113,.1)',
              borderRadius: '50%',
              color:        '#f87171',
              cursor:       'pointer',
              display:      'flex',
              alignItems:   'center',
              justifyContent: 'center',
              fontSize:     15,
              flexShrink:   0,
              transition:   'background 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background    = 'rgba(248,113,113,.28)';
              e.currentTarget.style.borderColor   = '#f87171';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background    = 'rgba(248,113,113,.1)';
              e.currentTarget.style.borderColor   = 'rgba(248,113,113,.5)';
            }}
          >
            ⏹
          </button>
        </div>
      </div>
    </div>
  );
}
