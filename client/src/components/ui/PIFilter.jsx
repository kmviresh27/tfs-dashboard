import { useState } from 'react';
import useStore from '../../store/useStore.js';

export default function PIFilter({ availablePIs, selectedPIs, onApply, onClose }) {
  const piFilterYear = useStore(s => s.piFilterYear);
  const setPiFilterYear = useStore(s => s.setPiFilterYear);

  const years = [...new Set(availablePIs.map(p => p.yy).filter(v => v != null))].sort((a, b) => a - b);
  const activeYear = piFilterYear ?? years[years.length - 1];
  const visiblePIs = availablePIs.filter(p => p.yy === activeYear);

  const [local, setLocal] = useState(selectedPIs);

  const toggle = (label) => {
    setLocal(prev => prev.includes(label) ? prev.filter(x => x !== label) : [...prev, label]);
  };

  return (
    <div className="pi-filter-panel">
      <div className="pi-filter-title">Filter by PI</div>
      {years.length > 1 && (
        <div className="pi-year-row">
          {years.map(y => (
            <button key={y} className={`pi-year-btn ${y === activeYear ? 'active' : ''}`}
              onClick={() => setPiFilterYear(y)}>
              {y}
            </button>
          ))}
        </div>
      )}
      <div className="pi-filter-grid">
        {visiblePIs.map(p => (
          <button key={p.label}
            className={`pi-check-btn ${local.includes(p.label) ? 'selected' : ''} ${p.isCurrent ? 'current' : ''}`}
            onClick={() => toggle(p.label)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="pi-filter-footer">
        <div className="pi-filter-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => { setLocal([]); onApply([]); }}>Clear</button>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={() => { onApply(local); onClose(); }}>Apply</button>
        </div>
      </div>
    </div>
  );
}
