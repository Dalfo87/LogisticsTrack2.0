/**
 * LogisticsTrack — Events Page
 * Tabella eventi completa con filtri dinamici e paginazione server-side.
 */
import { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import DataTable from '../components/DataTable/DataTable';
import FilterPanel from '../components/FilterPanel/FilterPanel';
import { fetchEvents } from '../services/api';
import { eventColumns, eventFilters } from '../config/eventColumns';

const PAGE_SIZE = 25;

const emptyFilters = Object.fromEntries(eventFilters.map((f) => [f.key, '']));

export default function Events() {
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(emptyFilters);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      // Costruisci parametri query
      const params = { page, page_size: PAGE_SIZE };
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== '' && value != null) {
          params[key] = value;
        }
      });

      const data = await fetchEvents(params);
      setEvents(data?.events || []);
      setTotal(data?.total || 0);
    } catch (err) {
      console.error('Errore caricamento eventi:', err);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const handleFilterChange = (newFilters) => {
    setFilters(newFilters);
    setPage(1); // Reset pagina quando cambiano i filtri
  };

  const handleFilterReset = () => {
    setFilters(emptyFilters);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Eventi</h1>
          <p className="text-sm text-slate-500 mt-1">
            {total} eventi registrati
          </p>
        </div>
        <button
          onClick={loadEvents}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg
                     bg-slate-800 text-slate-300 text-sm
                     hover:bg-slate-700 transition-colors
                     disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Aggiorna
        </button>
      </div>

      {/* Filtri */}
      <FilterPanel
        filters={eventFilters}
        values={filters}
        onChange={handleFilterChange}
        onReset={handleFilterReset}
      />

      {/* Tabella */}
      <DataTable
        columns={eventColumns}
        data={events}
        loading={loading}
        emptyMessage="Nessun evento trovato con i filtri selezionati."
        pagination={{ page, pageSize: PAGE_SIZE, total }}
        onPageChange={setPage}
      />
    </div>
  );
}
