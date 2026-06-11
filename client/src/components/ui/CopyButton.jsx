import { useRef, useState, useCallback } from 'react';
import html2canvas from 'html2canvas';

/** Clipboard SVG icon */
function ClipboardIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="5" y="1" width="6" height="2" rx="1" fill="currentColor" />
      <path d="M3 2.5h1.5V4h7V2.5H13A1.5 1.5 0 0 1 14.5 4v9A1.5 1.5 0 0 1 13 14.5H3A1.5 1.5 0 0 1 1.5 13V4A1.5 1.5 0 0 1 3 2.5Z"
        stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

/** Checkmark SVG icon */
function CheckIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3 8.5l3.5 3.5 6.5-7" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Expand icon */
function ExpandIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M1.5 5.5V2h3.5M10 2h3.5v3.5M14.5 10.5V14H11M6 14H2.5v-3.5"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Compress icon */
function CompressIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M5 1.5V5H1.5M14.5 5H11V1.5M11 14.5V11h3.5M1.5 11H5v3.5"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * CopyButton — copies the nearest chart (canvas) or table to clipboard.
 * When type='chart', also renders an expand/fullscreen button.
 * Uses CSS position:fixed overlay instead of native requestFullscreen to avoid
 * grid layout corruption when exiting fullscreen.
 */
export default function CopyButton({ type = 'chart', title, expand = true }) {
  const btnRef  = useRef(null);
  const [status, setStatus]     = useState('idle'); // idle | success | error
  const [isExpanded, setIsExpanded] = useState(false);

  const handleExpand = useCallback((e) => {
    const card = e.currentTarget.closest('.card')
      || e.currentTarget.closest('[data-copy-scope]');
    if (!card) return;
    if (!isExpanded) {
      card.classList.add('chart-expanded');
      setIsExpanded(true);
    } else {
      // Clamp to container width BEFORE removing the class so the chart
      // canvas never sees a 100vw size when it re-enters document flow.
      card.style.maxWidth = '100%';
      card.style.overflow = 'hidden';
      card.classList.remove('chart-expanded');
      setIsExpanded(false);
      requestAnimationFrame(() => {
        card.style.maxWidth = '';
        card.style.overflow = '';
      });
    }
  }, [isExpanded]);

  /** Write a blob to clipboard, or download it as PNG if clipboard is unavailable */
  const writeOrDownload = useCallback(async (blob, filename) => {
    const canClip = typeof ClipboardItem !== 'undefined'
      && navigator.clipboard?.write;
    if (canClip) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'chart.png';
      a.click();
      URL.revokeObjectURL(url);
    }
  }, []);

  const handleCopy = useCallback(async () => {
    const btn = btnRef.current;
    if (!btn) return;

    const container = btn.closest('.card')
      || btn.closest('.table-modal-panel')
      || btn.closest('[data-copy-scope]');
    if (!container) return;

    try {
      if (type === 'chart') {
        const canvas = container.querySelector('canvas');
        const bg = getComputedStyle(container).backgroundColor;
        const solidBg = bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#1e1e1e';

        let blob;
        if (canvas) {
          // Chart.js canvas — composite onto opaque background
          const off = document.createElement('canvas');
          off.width  = canvas.width;
          off.height = canvas.height;
          const ctx = off.getContext('2d');
          ctx.fillStyle = solidBg;
          ctx.fillRect(0, 0, off.width, off.height);
          ctx.drawImage(canvas, 0, 0);
          blob = await new Promise((res, rej) =>
            off.toBlob(b => b ? res(b) : rej(new Error('toBlob null')), 'image/png')
          );
        } else {
          // CSS chart (e.g. dumbbell) — use html2canvas
          const snap = await html2canvas(container, {
            backgroundColor: solidBg,
            scale: window.devicePixelRatio || 2,
            useCORS: true,
            logging: false,
          });
          blob = await new Promise((res, rej) =>
            snap.toBlob(b => b ? res(b) : rej(new Error('toBlob null')), 'image/png')
          );
        }

        await writeOrDownload(blob, `${title || 'chart'}.png`);
      } else {
        // table — copy as both HTML (rich paste) and TSV (Excel-friendly)
        const table = container.querySelector('table');
        if (!table) return;

        const rows = Array.from(table.querySelectorAll('tr'));
        const tsv  = rows
          .map(row =>
            Array.from(row.querySelectorAll('th, td'))
              .map(cell => cell.innerText.replace(/\t/g, ' ').trim())
              .join('\t')
          )
          .join('\n');

        if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/html' : new Blob([table.outerHTML], { type: 'text/html'  }),
              'text/plain': new Blob([tsv],             { type: 'text/plain' }),
            }),
          ]);
        } else {
          await navigator.clipboard.writeText(tsv);
        }
      }

      setStatus('success');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (err) {
      console.error('CopyButton: copy failed', err);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2000);
    }
  }, [type, title, writeOrDownload]);

  const color = status === 'success'
    ? 'var(--success, #39ff14)'
    : status === 'error'
    ? 'var(--danger, #eb3f3f)'
    : 'var(--muted)';

  const btnStyle = {
    background: 'none', border: 'none', cursor: 'pointer',
    padding: '2px 4px', color: 'var(--muted)', transition: 'color 0.2s',
    lineHeight: 1, flexShrink: 0, display: 'inline-flex', alignItems: 'center',
  };

  return (
    <>
      {type === 'chart' && expand && (
        <button
          onClick={handleExpand}
          title={isExpanded ? 'Collapse chart' : 'Expand chart'}
          style={{ ...btnStyle, color: isExpanded ? '#1492ff' : 'var(--muted)' }}
        >
          {isExpanded ? <CompressIcon /> : <ExpandIcon />}
        </button>
      )}
      <button
        ref={btnRef}
        onClick={handleCopy}
        title={title || (type === 'chart' ? 'Copy chart as image' : 'Copy table to clipboard')}
        style={{ ...btnStyle, color }}
      >
        {status === 'success' ? <CheckIcon /> : <ClipboardIcon />}
      </button>
    </>
  );
}

