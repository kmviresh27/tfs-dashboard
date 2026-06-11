import { useState, useEffect } from 'react';
import CopyButton from './CopyButton.jsx';
import DownloadCSVButton from './DownloadCSVButton.jsx';

/**
 * TableModal — wraps any table behind a trigger button.
 * Usage:
 *   <TableModal label="View Features" title="Feature List" csvFilename="features.csv">
 *     <table className="data-table">...</table>
 *   </TableModal>
 */
export default function TableModal({ label, title, badge, children, btnClassName = 'btn btn-ghost btn-sm', btnStyle, csvFilename }) {
  const [open, setOpen] = useState(false);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Derive a sensible CSV filename from the title if not provided
  const csvFile = csvFilename || (title ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.csv' : 'data.csv');

  return (
    <>
      <button className={btnClassName} style={btnStyle} onClick={() => setOpen(true)} aria-label={title || label || 'Open table dialog'}>
        {label}
        {badge != null && (
          <span style={{
            marginLeft: 6, fontSize: 11, fontWeight: 700,
            background: 'rgba(255,255,255,0.12)', padding: '1px 6px',
            color: '#fff'
          }}>{badge}</span>
        )}
      </button>

      {open && (
        <div
          className="table-modal-overlay"
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.65)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            className="table-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label={title || label || 'Table dialog'}
            style={{ background:'var(--surface)', border:'1px solid var(--border)', width:'90vw', maxWidth:1100, maxHeight:'85vh', display:'flex', flexDirection:'column', overflow:'hidden' }}
          >
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
              <span style={{ fontWeight:700, fontSize:14, color:'var(--text)' }}>{title}</span>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <DownloadCSVButton filename={csvFile} />
                <CopyButton type="table" title="Copy table to clipboard" />
                <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close table dialog">✕ Close</button>
              </div>
            </div>
            <div style={{ overflowY:'auto', padding:'12px 16px', flex:1 }}>
              {children}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
