/**
 * LogisticsTrack — FilterPanel
 * Pannello filtri generato dinamicamente dalla configurazione.
 * Ogni filtro ha tipo: text, number, select, datetime-local.
 */
import { RotateCcw } from 'lucide-react';

export default function FilterPanel({ filters, values, onChange, onReset }) {
  const handleChange = (key, value) => {
    onChange({ ...values, [key]: value });
  };

  const hasActiveFilters = Object.values(values).some((v) => v !== '' && v != null);

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          Filtri
        </span>
        {hasActiveFilters && (
          <button
            onClick={onReset}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            <RotateCcw size={12} />
            Reset
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {filters.map((filter) => (
          <div key={filter.key} className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">{filter.label}</label>

            {filter.type === 'select' ? (
              <select
                value={values[filter.key] || ''}
                onChange={(e) => handleChange(filter.key, e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5
                           text-sm text-slate-200 focus:outline-none focus:border-blue-500
                           transition-colors"
              >
                {filter.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={filter.type || 'text'}
                value={values[filter.key] || ''}
                onChange={(e) => handleChange(filter.key, e.target.value)}
                placeholder={filter.placeholder || ''}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5
                           text-sm text-slate-200 placeholder-slate-600
                           focus:outline-none focus:border-blue-500
                           transition-colors"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
