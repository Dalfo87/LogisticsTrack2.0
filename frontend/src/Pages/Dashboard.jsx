/**
 * LogisticsTrack — Dashboard Page
 * Panoramica sistema: statistiche, stato, ultimi eventi.
 */
import { useEffect, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  AlertCircle,
  LogIn,
  LogOut,
  Timer,
} from 'lucide-react';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable/DataTable';
import { fetchEventsSummary, fetchEvents } from '../services/api';
import { eventColumns } from '../config/eventColumns';

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [recentEvents, setRecentEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [summaryData, eventsData] = await Promise.all([
        fetchEventsSummary(),
        fetchEvents({ page: 1, page_size: 10 }),
      ]);
      setSummary(summaryData);
      setRecentEvents(eventsData?.events || []);
    } catch (err) {
      console.error('Errore caricamento dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // Auto-refresh ogni 30 secondi
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const byType = summary?.by_type || {};

  return (
    <div className="space-y-6">
      {/* Titolo */}
      <div>
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">Panoramica sistema LogisticsTrack</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard
          label="Totale eventi"
          value={summary?.total_events}
          icon={CalendarClock}
          color="blue"
        />
        <StatCard
          label="Ingressi"
          value={byType.roi_enter}
          icon={LogIn}
          color="green"
        />
        <StatCard
          label="Uscite"
          value={byType.roi_exit}
          icon={LogOut}
          color="blue"
        />
        <StatCard
          label="Soste"
          value={byType.dwell_time}
          icon={Timer}
          color="amber"
        />
        <StatCard
          label="Validati"
          value={summary?.validated}
          icon={CheckCircle2}
          color="green"
        />
      </div>

      {/* Ultimi eventi */}
      <div>
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">
          Ultimi eventi
        </h2>
        <DataTable
          columns={eventColumns}
          data={recentEvents}
          loading={loading}
          emptyMessage="Nessun evento registrato. Avvia il Video Analyzer per generare eventi."
        />
      </div>
    </div>
  );
}
