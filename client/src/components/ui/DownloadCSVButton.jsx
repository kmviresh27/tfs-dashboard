import { useRef, useState, useCallback } from 'react';

function DownloadIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8 1v9M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 12v1.5A1.5 1.5 0 0 0 3.5 15h9a1.5 1.5 0 0 0 1.5-1.5V12"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3 8.5l3.5 3.5 6.5-7" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * DownloadCSVButton — finds the nearest <table> and downloads it as a .csv file.
 *
 * Walks up to: .card > .table-modal-panel > [data-copy-scope]
 *
 * Props:
 *   filename — downloaded file name (default: 'data.csv')
 *   title    — tooltip
 */
export default function DownloadCSVButton({ filename = 'data.csv', title }) {
  const btnRef = useRef(null);
  const [status, setStatus] = useState('idle');

  const handleDownload = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;

    const container = btn.closest('.card')
      || btn.closest('.table-modal-panel')
      || btn.closest('[data-copy-scope]');
    if (!container) return;

    const table = container.querySelector('table');
    if (!table) return;

    // Build CSV rows (RFC 4180: quote fields containing comma/quote/newline)
    const rows = Array.from(table.querySelectorAll('tr'));
    const csv = rows.map(row =>
      Array.from(row.querySelectorAll('th, td'))
        .map(cell => {
          const text = cell.innerText.replace(/\r?\n/g, ' ').trim();
          // Wrap in quotes if contains comma, quote, or newline
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(',')
    ).join('\r\n');

    // UTF-8 BOM so Excel opens with correct encoding
    const bom   = '\uFEFF';
    const blob  = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url   = URL.createObjectURL(blob);
    const link  = document.createElement('a');
    link.href     = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setStatus('success');
    setTimeout(() => setStatus('idle'), 2000);
  }, [filename]);

  const color = status === 'success'
    ? 'var(--success, #39ff14)'
    : 'var(--muted)';

  return (
    <button
      ref={btnRef}
      onClick={handleDownload}
      title={title || `Download as CSV (${filename})`}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '2px 4px',
        color,
        transition: 'color 0.2s',
        lineHeight: 1,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      {status === 'success' ? <CheckIcon /> : <DownloadIcon />}
    </button>
  );
}
