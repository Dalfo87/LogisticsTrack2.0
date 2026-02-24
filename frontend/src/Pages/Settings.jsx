/**
 * LogisticsTrack — Settings Page
 * Tre sezioni:
 *   1. Modello YOLO — selezione file .pt + restart
 *   2. Parametri rilevamento — confidence, IoU, target classes (live)
 *   3. Visualizzazione bounding box — spessore linea, testo, dot, qualità MJPEG, overlay
 *
 * Tutte le chiamate puntano allo stream server (porta 8765) tramite proxy Vite /video-stream.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Settings as SettingsIcon,
  Cpu,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  WifiOff,
  ChevronDown,
  RotateCcw,
  Sliders,
  Eye,
  Square,
  Save,
} from 'lucide-react';

const STREAM_BASE = '/video-stream';

async function apiFetch(path, options) {
  const res = await fetch(`${STREAM_BASE}${path}`, {
    signal: AbortSignal.timeout(5000),
    ...options,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function patchConfig(patch) {
  return apiFetch('/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

// ─── Sub-componenti UI ──────────────────────────────────────────────────────

function SliderRow({ label, tooltip, value, min, max, step = 1, unit = '', format, onChange }) {
  const display = format ? format(value) : `${value}${unit}`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400" title={tooltip}>{label}</span>
        <span className="text-xs font-mono text-slate-200 bg-slate-800 px-2 py-0.5 rounded min-w-[3.5rem] text-center">
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10))}
        className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-blue-500"
      />
      <div className="flex justify-between text-[10px] text-slate-600">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

function ToggleRow({ label, tooltip, value, onChange }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-400" title={tooltip}>{label}</span>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition-colors ${
          value ? 'bg-blue-600' : 'bg-slate-700'
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
            value ? 'left-5' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

function ApplyFeedback({ result, errorMsg }) {
  if (result === 'success') return (
    <span className="flex items-center gap-1.5 text-xs text-emerald-400">
      <CheckCircle size={13} /> Applicato
    </span>
  );
  if (result === 'error') return (
    <span className="flex items-center gap-1.5 text-xs text-red-400">
      <AlertTriangle size={13} /> {errorMsg}
    </span>
  );
  return null;
}

// ─── Componente principale ──────────────────────────────────────────────────

export default function Settings() {
  // ── stato connessione ──
  const [serverOnline, setServerOnline]   = useState(null);
  const [currentConfig, setCurrentConfig] = useState(null);
  const [models, setModels]               = useState([]);
  const [classes, setClasses]             = useState([]);   // [{ id, name }]
  const [loadingModels, setLoadingModels] = useState(false);

  // ── sezione 1: modello ──
  const [selectedModel, setSelectedModel] = useState('');
  const [applying, setApplying]           = useState(false);
  const [applyResult, setApplyResult]     = useState(null);
  const [applyError, setApplyError]       = useState('');

  // ── sezione 2: parametri rilevamento ──
  const [conf, setConf]                         = useState(40);   // 10-100 (%)
  const [iou, setIou]                           = useState(45);   // 10-100 (%)
  const [selectedClasses, setSelectedClasses]   = useState([]);   // [] = tutte
  const [detApplying, setDetApplying]           = useState(false);
  const [detResult, setDetResult]               = useState(null);
  const [detError, setDetError]                 = useState('');

  // ── sezione 3: bounding box ──
  const [bboxThick, setBboxThick]   = useState(2);
  const [fontScale, setFontScale]   = useState(0.6);
  const [fontThick, setFontThick]   = useState(2);
  const [showLabel, setShowLabel]   = useState(true);
  const [showDot, setShowDot]       = useState(true);
  const [jpegQuality, setJpegQuality] = useState(65);
  const [showOverlay, setShowOverlay] = useState(true);
  const [bboxApplying, setBboxApplying] = useState(false);
  const [bboxResult, setBboxResult]   = useState(null);
  const [bboxError, setBboxError]     = useState('');

  // ── feedback auto-clear ──
  function autoReset(setter, ms = 3000) {
    setTimeout(() => setter(null), ms);
  }

  // ── fetch dati ──
  const fetchAll = useCallback(async () => {
    setLoadingModels(true);
    try {
      const [cfg, mdls, cls] = await Promise.all([
        apiFetch('/config'),
        apiFetch('/models'),
        apiFetch('/classes').catch(() => []),   // graceful: classi potrebbero non essere pronte
      ]);

      setCurrentConfig(cfg);
      setModels(mdls);
      setClasses(cls);

      // Inizializza stati sezione modello
      setSelectedModel((prev) => {
        if (cfg.model_path) return cfg.model_path;
        if (mdls.length > 0 && !prev) return mdls[0].path;
        return prev;
      });

      // Inizializza stati sezione rilevamento
      setConf(Math.round((cfg.confidence ?? 0.4) * 100));
      setIou(Math.round((cfg.iou ?? 0.45) * 100));
      setSelectedClasses(cfg.target_classes ?? []);

      // Inizializza stati sezione bbox
      setBboxThick(cfg.bbox_thickness  ?? 2);
      setFontScale(cfg.font_scale      ?? 0.6);
      setFontThick(cfg.font_thickness  ?? 2);
      setShowLabel(cfg.show_label      ?? true);
      setShowDot(cfg.show_dot          ?? true);
      setJpegQuality(cfg.jpeg_quality  ?? 65);
      setShowOverlay(cfg.show_overlay  ?? true);

      setServerOnline(true);
    } catch {
      setServerOnline(false);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${STREAM_BASE}/health`, { signal: AbortSignal.timeout(3000) });
      const online = res.ok;
      setServerOnline(online);
      if (online) fetchAll();
    } catch {
      setServerOnline(false);
    }
  }, [fetchAll]);

  useEffect(() => {
    checkHealth();
    const id = setInterval(checkHealth, 15000);
    return () => clearInterval(id);
  }, [checkHealth]);

  // ── handlers ──

  // Sezione 1: Applica modello (richiede restart)
  const handleApplyModel = async () => {
    if (!selectedModel) return;
    setApplying(true);
    setApplyResult(null);
    setApplyError('');
    try {
      await patchConfig({ model_path: selectedModel });
      await apiFetch('/restart', { method: 'POST' });
      setApplyResult('success');
      setTimeout(() => {
        setCurrentConfig((c) => ({ ...c, model_path: selectedModel }));
        setApplyResult(null);
      }, 4000);
    } catch (err) {
      setApplyResult('error');
      setApplyError(err.message || 'Errore sconosciuto');
    } finally {
      setApplying(false);
    }
  };

  // Sezione 2: Applica parametri rilevamento (live, no restart)
  const handleApplyDetection = async () => {
    setDetApplying(true);
    setDetResult(null);
    setDetError('');
    try {
      await patchConfig({
        confidence: conf / 100,
        iou: iou / 100,
        target_classes: selectedClasses.length > 0 ? selectedClasses : null,
      });
      setDetResult('success');
      autoReset(setDetResult);
    } catch (err) {
      setDetResult('error');
      setDetError(err.message || 'Errore sconosciuto');
    } finally {
      setDetApplying(false);
    }
  };

  // Sezione 3: Applica proprietà bbox (live, no restart)
  const handleApplyBbox = async () => {
    setBboxApplying(true);
    setBboxResult(null);
    setBboxError('');
    try {
      await patchConfig({
        bbox_thickness: bboxThick,
        font_scale: fontScale,
        font_thickness: fontThick,
        show_label: showLabel,
        show_dot: showDot,
        jpeg_quality: jpegQuality,
        show_overlay: showOverlay,
      });
      setBboxResult('success');
      autoReset(setBboxResult);
    } catch (err) {
      setBboxResult('error');
      setBboxError(err.message || 'Errore sconosciuto');
    } finally {
      setBboxApplying(false);
    }
  };

  // Toggle singolo per classi
  const toggleClass = (id) => {
    setSelectedClasses((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  // ── helpers ──
  const activeModelName = currentConfig?.model_path
    ? currentConfig.model_path.split('/').pop()
    : '(default .env)';
  const selectedModelInfo = models.find((m) => m.path === selectedModel);
  const isDefaultInEnv    = !currentConfig?.model_path;
  const isSameModel       = selectedModel === (currentConfig?.model_path ?? '');

  // ── render ──
  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Impostazioni</h1>
        <p className="text-sm text-slate-500 mt-1">Configurazione sistema</p>
      </div>

      {/* Badge stato stream server — condiviso tra sezioni */}
      <div className="flex items-center gap-2 text-xs">
        {serverOnline === null && <><span className="w-2 h-2 rounded-full bg-slate-500 animate-pulse" /><span className="text-slate-500">verifica stream server...</span></>}
        {serverOnline === true  && <><span className="w-2 h-2 rounded-full bg-emerald-500" /><span className="text-emerald-400">stream server online</span></>}
        {serverOnline === false && (
          <>
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-red-400">stream server offline</span>
            <button
              onClick={checkHealth}
              className="ml-2 px-3 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700
                         rounded-lg transition-colors"
            >
              Riprova
            </button>
          </>
        )}
      </div>

      {serverOnline === false && (
        <div className="flex flex-col items-center gap-3 py-8 text-slate-400
                        bg-slate-900/60 border border-slate-800 rounded-xl">
          <WifiOff size={32} className="text-slate-600" />
          <p className="text-sm">Stream server non raggiungibile (porta 8765)</p>
          <p className="text-xs text-slate-600 text-center max-w-xs">
            Avvia il <code>video_analyzer</code> con{' '}
            <code>VA_STREAM_ENABLED=true</code>
          </p>
        </div>
      )}

      {serverOnline !== false && (
        <>
          {/* ── Sezione 1: Modello YOLO ─────────────────────────────────── */}
          <section className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800">
              <Cpu size={18} className="text-blue-400 shrink-0" />
              <div>
                <h2 className="text-sm font-semibold text-white">Modello YOLO</h2>
                <p className="text-xs text-slate-500">
                  Seleziona il file .pt da{' '}
                  <code className="text-slate-400">video_analyzer/models/</code>
                </p>
              </div>
            </div>

            <div className="px-5 py-5 space-y-5">
              {/* Modello attivo */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Modello attivo</span>
                <span className="text-xs font-mono text-slate-200 bg-slate-800 px-2 py-1 rounded">
                  {currentConfig ? activeModelName : '…'}
                  {isDefaultInEnv && currentConfig && (
                    <span className="ml-2 text-slate-500">(da .env)</span>
                  )}
                </span>
              </div>

              {/* Selettore file .pt */}
              <div className="space-y-2">
                <label className="text-xs text-slate-400 block">
                  Seleziona modello
                  {loadingModels && <span className="ml-2 text-slate-600">caricamento…</span>}
                </label>

                {!loadingModels && models.length === 0 && serverOnline && (
                  <p className="text-xs text-slate-600 italic">
                    Nessun file .pt trovato in <code>video_analyzer/models/</code>.
                  </p>
                )}

                {models.length > 0 && (
                  <>
                    <div className="relative">
                      <select
                        value={selectedModel}
                        onChange={(e) => { setSelectedModel(e.target.value); setApplyResult(null); }}
                        disabled={applying}
                        className="w-full appearance-none bg-slate-800 border border-slate-700
                                   text-slate-200 text-sm rounded-lg px-3 py-2.5 pr-8
                                   focus:outline-none focus:border-blue-500
                                   disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {models.map((m) => (
                          <option key={m.path} value={m.path}>{m.name} — {m.size_mb} MB</option>
                        ))}
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                    </div>
                    {selectedModelInfo && (
                      <p className="text-xs text-slate-600">
                        Path: <code className="text-slate-500">{selectedModelInfo.path}</code>
                        {' · '}{selectedModelInfo.size_mb} MB
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Avviso restart */}
              <div className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/20
                              rounded-lg px-4 py-3 text-xs text-amber-400/80">
                <RotateCcw size={13} className="mt-0.5 shrink-0" />
                <span>
                  Il cambio modello riavvia il loop di analisi YOLO (downtime stream ~3–5 s).
                  I parametri runtime (confidence, IoU) vengono mantenuti.
                </span>
              </div>

              {/* Pulsante Apply */}
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={handleApplyModel}
                  disabled={applying || isSameModel || models.length === 0 || !serverOnline}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500
                             disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
                             text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {applying
                    ? <><RefreshCw size={14} className="animate-spin" /> Applicazione…</>
                    : <><SettingsIcon size={14} /> Applica e riavvia</>
                  }
                </button>
                {!applying && !applyResult && isSameModel && models.length > 0 && (
                  <span className="text-xs text-slate-600">Modello già attivo</span>
                )}
                {applyResult === 'success' && (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <CheckCircle size={14} /> Restart avviato — stream disponibile tra pochi secondi
                  </span>
                )}
                {applyResult === 'error' && (
                  <span className="flex items-center gap-1.5 text-xs text-red-400">
                    <AlertTriangle size={14} /> {applyError}
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* ── Sezione 2: Parametri Rilevamento ────────────────────────── */}
          <section className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800">
              <Sliders size={18} className="text-violet-400 shrink-0" />
              <div>
                <h2 className="text-sm font-semibold text-white">Parametri Rilevamento</h2>
                <p className="text-xs text-slate-500">Applicati live senza restart</p>
              </div>
            </div>

            <div className="px-5 py-5 space-y-5">
              <SliderRow
                label="Confidence"
                tooltip="Soglia minima di certezza per accettare una detection. Basso → più rilevamenti (inclusi falsi positivi), alto → solo rilevamenti certi."
                value={conf}
                min={10}
                max={100}
                unit="%"
                onChange={setConf}
              />
              <SliderRow
                label="IoU (NMS)"
                tooltip="Intersection over Union per Non-Maximum Suppression: elimina box sovrapposti dello stesso oggetto. Basso → mantiene solo il migliore, alto → tollera più sovrapposizione."
                value={iou}
                min={10}
                max={100}
                unit="%"
                onChange={setIou}
              />

              {/* Target classes */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">
                    Classi target
                    <span className="ml-1.5 text-slate-600">
                      {selectedClasses.length === 0 ? '(tutte)' : `${selectedClasses.length} selezionate`}
                    </span>
                  </span>
                  {selectedClasses.length > 0 && (
                    <button
                      onClick={() => setSelectedClasses([])}
                      className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      Deseleziona tutto
                    </button>
                  )}
                </div>

                {classes.length === 0 ? (
                  <p className="text-xs text-slate-600 italic">
                    Nessuna classe disponibile (avvia il video_analyzer con un modello caricato).
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto pr-1
                                  scrollbar-thin scrollbar-track-slate-800 scrollbar-thumb-slate-600">
                    {classes.map(({ id, name }) => {
                      const active = selectedClasses.includes(id);
                      return (
                        <button
                          key={id}
                          onClick={() => toggleClass(id)}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs
                                      border transition-colors text-left
                                      ${active
                                        ? 'bg-violet-600/20 border-violet-500/50 text-violet-300'
                                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                                      }`}
                        >
                          <span className="font-mono text-[10px] text-slate-500 w-5 shrink-0">{id}</span>
                          <span className="truncate">{name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="text-[10px] text-slate-600">
                  Se nessuna classe è selezionata, il modello rileva tutte le classi disponibili.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleApplyDetection}
                  disabled={detApplying || !serverOnline}
                  className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500
                             disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
                             text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {detApplying
                    ? <><RefreshCw size={14} className="animate-spin" /> Applicazione…</>
                    : <><Save size={14} /> Applica</>
                  }
                </button>
                <ApplyFeedback result={detResult} errorMsg={detError} />
              </div>
            </div>
          </section>

          {/* ── Sezione 3: Visualizzazione Bounding Box ──────────────────── */}
          <section className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800">
              <Square size={18} className="text-emerald-400 shrink-0" />
              <div>
                <h2 className="text-sm font-semibold text-white">Visualizzazione Bounding Box</h2>
                <p className="text-xs text-slate-500">Aspetto grafico dei rilevamenti + stream MJPEG</p>
              </div>
            </div>

            <div className="px-5 py-5 space-y-5">
              <SliderRow
                label="Spessore linea bbox"
                tooltip="Spessore in pixel della rettangolo di rilevamento."
                value={bboxThick}
                min={1}
                max={8}
                unit="px"
                onChange={setBboxThick}
              />
              <SliderRow
                label="Dimensione testo"
                tooltip="Font scale OpenCV per le etichette classe/ID/confidence."
                value={fontScale}
                min={0.3}
                max={1.5}
                step={0.1}
                format={(v) => `${v.toFixed(1)}×`}
                onChange={setFontScale}
              />
              <SliderRow
                label="Spessore testo"
                tooltip="Spessore in pixel del testo dell'etichetta."
                value={fontThick}
                min={1}
                max={4}
                unit="px"
                onChange={setFontThick}
              />

              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                <ToggleRow
                  label="Mostra etichetta"
                  tooltip="Visualizza classe, track ID e confidence% accanto al bbox."
                  value={showLabel}
                  onChange={setShowLabel}
                />
                <ToggleRow
                  label="Mostra punto riferimento"
                  tooltip="Punto bottom_center usato dall'ROI engine per calcolare le intersezioni."
                  value={showDot}
                  onChange={setShowDot}
                />
                <ToggleRow
                  label="Overlay FPS/MQTT"
                  tooltip="Mostra in alto a sinistra: FPS correnti, stato MQTT e totale eventi."
                  value={showOverlay}
                  onChange={setShowOverlay}
                />
              </div>

              <SliderRow
                label="Qualità MJPEG"
                tooltip="Qualità di compressione JPEG per lo stream video. Più alta = immagine migliore ma più banda."
                value={jpegQuality}
                min={20}
                max={95}
                unit="%"
                onChange={setJpegQuality}
              />

              <div className="flex items-center gap-3">
                <button
                  onClick={handleApplyBbox}
                  disabled={bboxApplying || !serverOnline}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-600
                             disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
                             text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {bboxApplying
                    ? <><RefreshCw size={14} className="animate-spin" /> Applicazione…</>
                    : <><Eye size={14} /> Applica</>
                  }
                </button>
                <ApplyFeedback result={bboxResult} errorMsg={bboxError} />
              </div>
            </div>
          </section>
        </>
      )}

      {/* ── Placeholder sezioni future ───────────────────────────────────── */}
      <section className="bg-slate-900/60 border border-slate-800 rounded-xl px-5 py-4">
        <p className="text-xs text-slate-600 text-center">
          Ulteriori impostazioni (gestione utenti, configurazione WMS)
          saranno disponibili nelle prossime fasi.
        </p>
      </section>
    </div>
  );
}
