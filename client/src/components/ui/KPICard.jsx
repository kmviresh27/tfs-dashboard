export default function KPICard({ value, label, colorClass = '', ragClass = '' }) {
  return (
    <div className={`kpi-card ${colorClass} ${ragClass}`}>
      <div className="kpi-val">{value ?? '–'}</div>
      <div className="kpi-lbl">{label}</div>
    </div>
  );
}
