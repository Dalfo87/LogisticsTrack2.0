/**
 * LogisticsTrack — StatCard
 * Card con numero grande + label. Per la dashboard.
 */
export default function StatCard({ label, value, icon: Icon, color = 'blue', className = '' }) {
  const colorMap = {
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    green: 'bg-green-500/10 text-green-400 border-green-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    red: 'bg-red-500/10 text-red-400 border-red-500/20',
    slate: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  };

  const colors = colorMap[color] || colorMap.blue;

  return (
    <div className={`rounded-xl border ${colors} p-4 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium uppercase tracking-wider opacity-70">
          {label}
        </span>
        {Icon && <Icon size={16} className="opacity-50" />}
      </div>
      <div className="text-2xl font-bold font-mono">
        {value ?? '—'}
      </div>
    </div>
  );
}
