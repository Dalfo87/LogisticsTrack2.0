/**
 * LogisticsTrack — Dashboard Page
 * Panoramica sistema: statistiche, stato, ultimi eventi.
 *
 * Aggiornamento dati:
 *  - SSE EventSource su /api/events/stream → nuovi eventi in cima alla lista (real-time)
 *  - Polling ogni 5s per statistiche/contatori
 *  - Pulsante refresh manuale in alto a destra
 *  - Badge "● Live" verde / "○ Offline" rosso secondo stato SSE
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  LogIn,
  LogOut,
  Timer,
  RefreshCw,
  Wifi,
  WifiOff,
  Pause,
  Play,
} from 'lucide-react';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable/DataTable';
import { fetchEventsSummary, fetchEvents } from '../services/api';
import { eventColumns } from '../config/eventColumns';

const MAX_LIVE_EVENTS = 50; // massimo eventi in lista live
const SSE_RECONNECT_DELAY = 3000; // ms prima di riconnettersi SSE

export default function Dashboard() {
  const [summary, setSummary]         = useState(null);
  const [recentEvents, setRecentEvents] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [sseStatus, setSseStatus]     = useState('connecting'); // 'connecting' | 'live' | 'offline'
  const [isPaused, setIsPaused]       = useState(false);

  const sseRef            = useRef(null);
  const reconnectTimer    = useRef(null);
  const pollingInterval   = useRef(null);
  const mountedRef        = useRef(true);
  const isPausedRef       = useRef(false); // ref per evitare stale closure in es.onmessage

  // Allinea il ref con lo state (il ref è letto nei callback SSE, lo state pilota la UI)
  const togglePause = useCallback(() => {
    const next = !isPausedRef.current;
    isPausedRef.current = next;
    setIsPaused(next);
  }, []);

  // ── Carica statistiche e lista eventi (polling) ──
  const loadStats = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const summaryData = await fetchEventsSummary();
      if (mountedRef.current) setSummary(summaryData);
    } catch (err) {
      console.error('Errore caricamento stats:', err);
    } finally {
      if (showSpinner && mountedRef.current) setRefreshing(false);
    }
  }, []);

  const loadInitialEvents = useCallback(async () => {
    setLoading(true);
    try {
      const eventsData = await fetchEvents({ page: 1, page_size: MAX_LIVE_EVENTS });
      if (mountedRef.current) setRecentEvents(eventsData?.events || []);
    } catch (err) {
      console.error('Errore caricamento eventi:', err);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [summaryData, eventsData] = await Promise.all([
        fetchEventsSummary(),
        fetchEvents({ page: 1, page_size: MAX_LIVE_EVENTS }),
      ]);
      if (mountedRef.current) {
        setSummary(summaryData);
        setRecentEvents(eventsData?.events || []);
      }
    } catch (err) {
      console.error('Errore refresh manuale:', err);
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, []);

  // ── SSE EventSource ──
  const connectSSE = useCallback(() => {
    if (!mountedRef.current) return;

    // Chiudi eventuale connessione precedente
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }

    setSseStatus('connecting');

    const es = new EventSource('/api/events/stream');
    sseRef.current = es;

    es.onopen = () => {
      if (mountedRef.current) setSseStatus('live');
    };

    es.onmessage = (e) => {
      if (!mountedRef.current) return;
      if (isPausedRef.current) return;  // pausa: ignora messaggi SSE senza chiudere la connessione
      try {
        const event = JSON.parse(e.data);
        // Aggiunge il nuovo evento in cima alla lista (max MAX_LIVE_EVENTS)
        setRecentEvents((prev) => {
          const updated = [event, ...prev];
          return updated.slice(0, MAX_LIVE_EVENTS);
        });
        // Aggiorna anche il contatore totale
        setSummary((prev) =>
          prev
            ? {
                ...prev,
                total_events: (prev.total_events ?? 0) + 1,
                by_type: {
                  ...prev.by_type,
                  [event.event_type]: ((prev.by_type?.[event.event_type] ?? 0) + 1),
                },
              }
            : prev
        );
      } catch {
        // payload non valido — ignora
      }
    };

    es.onerror = () => {
      if (!mountedRef.current) return;
      setSseStatus('offline');
      es.close();
      sseRef.current = null;
      // Tenta riconnessione automatica
      reconnectTimer.current = setTimeout(() => {
        if (mountedRef.current) connectSSE();
      }, SSE_RECONNECT_DELAY);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lifecycle ──
  useEffect(() => {
    mountedRef.current = true;

    // Caricamento iniziale
    loadInitialEvents();
    loadStats();

    // Connetti SSE
    connectSSE();

    return () => {
      mountedRef.current = false;
      clearInterval(pollingInterval.current);
      clearTimeout(reconnectTimer.current);
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
    };
  }, [connectSSE, loadInitialEvents, loadStats]);

  // ── Polling separato: si ferma/riprende in base a isPaused ──
  useEffect(() => {
    clearInterval(pollingInterval.current);
    if (!isPaused) {
      // Carica subito quando si riprende, poi ogni 5s
      loadStats();
      pollingInterval.current = setInterval(() => loadStats(), 5000);
    }
    return () => clearInterval(pollingInterval.current);
  }, [isPaused, loadStats]);

  const byType = summary?.by_type || {};

  return (
    <div className="space-y-6">
      {/* Titolo + badge SSE + refresh */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Panoramica sistema LogisticsTrack</p>
        </div>

        <div className="flex items-center gap-2 mt-1">
          {/* Badge SSE / In pausa */}
          {isPaused ? (
            <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />In pausa
            </span>
          ) : (
            <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
              sseStatus === 'live'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : sseStatus === 'connecting'
                ? 'bg-slate-700/50 border-slate-600 text-slate-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}>
              {sseStatus === 'live' && (
                <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Live</>
              )}
              {sseStatus === 'connecting' && (
                <><span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse" />Connessione…</>
              )}
              {sseStatus === 'offline' && (
                <><WifiOff size={10} />Offline</>
              )}
            </span>
          )}

          {/* Pulsante refresh manuale */}
          <button
            onClick={handleManualRefresh}
            disabled={refreshing}
            title="Aggiorna dati"
            className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700
                       text-slate-400 hover:text-white transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>

          {/* Pulsante pausa/riprendi aggiornamento real-time */}
          <button
            onClick={togglePause}
            title={isPaused ? 'Riprendi aggiornamento real-time' : 'Pausa aggiornamento real-time'}
            className={`p-1.5 rounded-lg border transition-colors ${
              isPaused
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                : 'border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
            }`}
          >
            {isPaused ? <Play size={14} /> : <Pause size={14} />}
          </button>
        </div>
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
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
            Ultimi eventi
          </h2>
          {sseStatus === 'live' && !isPaused && (
            <span className="text-xs text-slate-600">
              Aggiornamento real-time attivo
            </span>
          )}
          {isPaused && (
            <span className="text-xs text-amber-700">
              Aggiornamento in pausa
            </span>
          )}
        </div>
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
