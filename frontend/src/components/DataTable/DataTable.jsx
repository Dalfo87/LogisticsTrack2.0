/**
 * LogisticsTrack — DataTable
 * Tabella generica guidata da configurazione colonne.
 *
 * Props:
 * - columns: array di { key, label, sortable, render, isHtml, className, uniqueKey }
 * - data: array di oggetti
 * - loading: boolean
 * - emptyMessage: stringa
 * - pagination: { page, pageSize, total } (opzionale)
 * - onPageChange: (page) => void (opzionale)
 */
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

export default function DataTable({
  columns,
  data = [],
  loading = false,
  emptyMessage = 'Nessun dato disponibile',
  pagination = null,
  onPageChange = null,
}) {
  const totalPages = pagination
    ? Math.ceil(pagination.total / pagination.pageSize)
    : 0;

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
      {/* Tabella con scroll orizzontale su mobile */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800">
              {columns.map((col) => (
                <th
                  key={col.uniqueKey || col.key + col.label}
                  className="text-left px-4 py-3 text-xs font-medium text-slate-500
                             uppercase tracking-wider whitespace-nowrap"
                  style={col.minWidth ? { minWidth: col.minWidth } : undefined}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center">
                  <Loader2 size={24} className="animate-spin mx-auto text-slate-500" />
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-slate-600"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row, rowIdx) => (
                <tr
                  key={row.id || rowIdx}
                  className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors"
                >
                  {columns.map((col) => {
                    const value = row[col.key];
                    let content;

                    if (col.render) {
                      const rendered = col.render(value, row);
                      if (col.isHtml) {
                        content = (
                          <span dangerouslySetInnerHTML={{ __html: rendered }} />
                        );
                      } else {
                        content = rendered;
                      }
                    } else {
                      content = value ?? '—';
                    }

                    return (
                      <td
                        key={col.uniqueKey || col.key + col.label}
                        className={`px-4 py-3 whitespace-nowrap ${col.className || ''}`}
                      >
                        {content}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Paginazione */}
      {pagination && totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800">
          <span className="text-xs text-slate-500">
            {pagination.total} risultati — Pagina {pagination.page}/{totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange?.(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800
                         disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => onPageChange?.(pagination.page + 1)}
              disabled={pagination.page >= totalPages}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800
                         disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
