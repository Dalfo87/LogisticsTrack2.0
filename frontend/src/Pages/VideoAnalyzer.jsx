/**
 * LogisticsTrack — Video Analyzer Page
 * Streaming video live (MJPEG) con bounding box YOLO.
 * Il flusso viene servito dal stream server integrato nel video_analyzer (porta 8765).
 * Funzionalità aggiuntive:
 *  - Toggle overlay FPS/MQTT/eventi (PATCH /video-stream/config)
 */
import { useEffect, useState, useCallback } from 'react';
import { Video, RefreshCw, Wifi, WifiOff, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { fetchCameras } from '../services/api';

// URL base dello stream server (proxied da Vite → localhost:8765)
const STREAM_BASE_URL = '/video-stream';
const STREAM_URL = `${STREAM_BASE_URL}/stream`;

async function patchStreamConfig(patch) {
  await fetch(`${STREAM_BASE_URL}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(3000),
  });
}

export default function VideoAnalyzer() {
  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [streamKey, setStreamKey] = useState(0);   // incrementa per forzare remount <img>
  const [streamError, setStreamError] = useState(false);
  const [streamLoaded, setStreamLoaded] = useState(false);
  const [serverOnline, setServerOnline] = useState(null);  // null = checking
  const [showOverlay, setShowOverlay] = useState(true);     // stato locale overlay toggle

  // Carica lista camere
  useEffect(() => {
    fetchCameras()
      .then((cams) => {
        setCameras(cams);
        if (cams.length > 0) setSelectedCamera(cams[0].camera_id || cams[0].id || '');
      })
      .catch(() => {});
  }, []);

  // Verifica che il stream server sia raggiungibile e leggi la config corrente
  const checkServerHealth = useCallback(async () => {
    try {
      const res = await fetch(`${STREAM_BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
      const online = res.ok;
      setServerOnline(online);
      // Leggi show_overlay dalla config corrente
      if (online) {
        try {
          const cfg = await fetch(`${STREAM_BASE_URL}/config`, { signal: AbortSignal.timeout(3000) });
          if (cfg.ok) {
            const data = await cfg.json();
            setShowOverlay(data.show_overlay ?? true);
          }
        } catch { /* non critico */ }
      }
    } catch {
      setServerOnline(false);
    }
  }, []);

  useEffect(() => {
    checkServerHealth();
    const interval = setInterval(checkServerHealth, 10000);
    return () => clearInterval(interval);
  }, [checkServerHealth]);

  const handleReconnect = () => {
    setStreamError(false);
    setStreamLoaded(false);
    setStreamKey((k) => k + 1);
  };

  const handleToggleOverlay = async () => {
    const next = !showOverlay;
    setShowOverlay(next);
    try {
      await patchStreamConfig({ show_overlay: next });
    } catch {
      // ripristina stato locale se la chiamata fallisce
      setShowOverlay(!next);
    }
  };

  const handleStreamLoad = () => {
    setStreamLoaded(true);
    setStreamError(false);
  };

  const handleStreamError = () => {
    setStreamError(true);
    setStreamLoaded(false);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Video Live</h1>
          <p className="text-sm text-slate-500 mt-1">
            Flusso video con rilevamento YOLO in tempo reale
          </p>
        </div>

        {/* Controlli */}
        <div className="flex items-center gap-3">
          {/* Dropdown camera */}
          <select
            value={selectedCamera}
            onChange={(e) => {
              setSelectedCamera(e.target.value);
              handleReconnect();
            }}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
          >
            {cameras.length === 0 && (
              <option value="">Nessuna camera registrata</option>
            )}
            {cameras.map((cam) => (
              <option key={cam.id} value={cam.camera_id || cam.id}>
                {cam.name}
              </option>
            ))}
          </select>

          {/* Toggle overlay */}
          {serverOnline && (
            <button
              onClick={handleToggleOverlay}
              title={showOverlay ? 'Nascondi overlay FPS/MQTT' : 'Mostra overlay FPS/MQTT'}
              className={`flex items-center gap-2 px-3 py-2 border text-sm rounded-lg transition-colors
                          ${showOverlay
                            ? 'bg-blue-600/20 border-blue-500/50 text-blue-300 hover:bg-blue-600/30'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                          }`}
            >
              {showOverlay ? <Eye size={14} /> : <EyeOff size={14} />}
              Overlay
            </button>
          )}

          {/* Pulsante riconnetti */}
          <button
            onClick={handleReconnect}
            title="Riconnetti stream"
            className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm rounded-lg transition-colors"
          >
            <RefreshCw size={14} />
            Riconnetti
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-4 text-xs text-slate-500">
        {/* Stato stream server */}
        <span className="flex items-center gap-1.5">
          {serverOnline === null && <span className="w-2 h-2 rounded-full bg-slate-500 animate-pulse" />}
          {serverOnline === true && <span className="w-2 h-2 rounded-full bg-emerald-500" />}
          {serverOnline === false && <span className="w-2 h-2 rounded-full bg-red-500" />}
          Stream server:{' '}
          {serverOnline === null ? 'verifica...' : serverOnline ? 'online' : 'offline'}
        </span>

        {/* Stato flusso video */}
        {serverOnline && (
          <span className="flex items-center gap-1.5">
            {streamLoaded && !streamError && (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-emerald-400">Live</span>
              </>
            )}
            {streamError && (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-amber-400">Segnale assente</span>
              </>
            )}
            {!streamLoaded && !streamError && (
              <>
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                <span>Connessione...</span>
              </>
            )}
          </span>
        )}

        <span className="ml-auto text-slate-600">MJPEG · ~10fps · porta 8765</span>
      </div>

      {/* Player video */}
      <div className="bg-black rounded-xl overflow-hidden border border-slate-800 relative" style={{ minHeight: '400px' }}>

        {/* Stream server offline */}
        {serverOnline === false && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400">
            <WifiOff size={40} className="text-slate-600" />
            <p className="text-sm font-medium">Stream server non raggiungibile</p>
            <p className="text-xs text-slate-600 text-center max-w-xs">
              Assicurati che il video_analyzer sia in esecuzione con VA_STREAM_ENABLED=true
              e che la porta 8765 sia esposta.
            </p>
            <button
              onClick={checkServerHealth}
              className="mt-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-sm rounded-lg border border-slate-700 transition-colors"
            >
              Riprova
            </button>
          </div>
        )}

        {/* Stream attivo */}
        {serverOnline && (
          <>
            {/* Immagine MJPEG */}
            <img
              key={streamKey}
              src={STREAM_URL}
              alt="Video stream YOLO"
              onLoad={handleStreamLoad}
              onError={handleStreamError}
              className="w-full h-full object-contain"
              style={{ display: streamError ? 'none' : 'block', minHeight: '400px' }}
            />

            {/* Overlay errore stream */}
            {streamError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400">
                <AlertTriangle size={40} className="text-amber-500" />
                <p className="text-sm font-medium">Flusso video non disponibile</p>
                <p className="text-xs text-slate-600 text-center max-w-xs">
                  Il server è online ma nessun frame è ancora disponibile.
                  Verifica che il video_analyzer stia elaborando una sorgente video.
                </p>
                <button
                  onClick={handleReconnect}
                  className="mt-2 flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-sm rounded-lg border border-slate-700 transition-colors"
                >
                  <RefreshCw size={14} />
                  Riconnetti
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Nota architetturale */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 text-xs text-slate-500">
        <p className="flex items-start gap-2">
          <Video size={14} className="mt-0.5 shrink-0 text-slate-600" />
          <span>
            Lo stream mostra il flusso della camera attualmente configurata nel video_analyzer
            (<code className="text-slate-400">CAMERA_ID</code> in .env).
            Il dropdown mostra le camere registrate nel DB — sarà funzionale quando sarà implementato
            il supporto multi-camera (Fase 7).
          </span>
        </p>
      </div>
    </div>
  );
}
