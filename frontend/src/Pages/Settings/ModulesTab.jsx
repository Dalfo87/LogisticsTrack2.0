/**
 * LogisticsTrack — Modules Tab
 * Tab per abilitare/disabilitare i moduli di analisi per una camera.
 * Mostra la configurazione modules_config della camera e permette
 * di aggiornare e propagare al video analyzer.
 *
 * Props:
 *   cameraId (string) — ID camera corrente
 */
import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Upload,
  CheckCircle,
  AlertTriangle,
  Package,
  Eye,
  EyeOff,
} from 'lucide-react';
import { fetchCameraModules, updateCameraModules, exportCameraModules } from '../../services/api';

// Moduli supportati con metadati di visualizzazione
const MODULE_META = {
  logistics: {
    label: 'Logistics',
    description: 'Tracciamento muletti in corsie/scaffali. Genera eventi roi_enter, roi_exit, dwell_time.',
    color: 'blue',
  },
  no_entry_filter: {
    label: 'No Entry Filter',
    description: 'Rilevamento persone in zone non autorizzate. Distingue tra DPI (giubbetto) e assenza DPI.',
    color: 'orange',
  },
};

// Configurazione default per ogni modulo
const MODULE_DEFAULTS = {
  logistics: {
    roi_file: 'data/rois.json',
  },
  no_entry_filter: {
    roi_file: 'data/rois.json',
    pose_model_path: null,
    classifier_model_path: null,
    authorized_vests: ['orange', 'yellow', 'green'],
    smoothing_window: 10,
    min_dwell_before_alert: 2.0,
  },
};

export default function ModulesTab({ cameraId }) {
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saveResult, setSaveResult] = useState(null); // 'success' | 'error'
  const [exportResult, setExportResult] = useState(null);
  const [dirty, setDirty] = useState(false);

  const loadModules = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchCameraModules(cameraId);
      setModules(data?.modules ?? []);
    } catch (err) {
      console.error('Errore caricamento moduli:', err);
    } finally {
      setLoading(false);
    }
  }, [cameraId]);

  useEffect(() => { loadModules(); }, [loadModules]);

  // Ottieni la lista aggiornata (con moduli default se mancanti)
  const getEffectiveModules = () => {
    const existing = new Map(modules.map((m) => [m.type, m]));
    return Object.keys(MODULE_META).map((type) => (
      existing.get(type) ?? { type, enabled: false, config: MODULE_DEFAULTS[type] ?? {} }
    ));
  };

  const handleToggle = (type) => {
    const effective = getEffectiveModules();
    const updated = effective.map((m) =>
      m.type === type ? { ...m, enabled: !m.enabled } : m
    );
    setModules(updated);
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const effective = getEffectiveModules();
      await updateCameraModules(cameraId, { modules: effective });
      setSaveResult('success');
      setDirty(false);
      setTimeout(() => setSaveResult(null), 3000);
    } catch (err) {
      setSaveResult('error');
      console.error('Errore salvataggio moduli:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setExportResult(null);
    try {
      const result = await exportCameraModules(cameraId);
      setExportResult(result);
      setTimeout(() => setExportResult(null), 5000);
    } catch (err) {
      alert(`Errore export: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return <div className="py-8 text-center text-slate-600">Caricamento moduli...</div>;
  }

  const effectiveModules = getEffectiveModules();

  return (
    <div className="space-y-4">
      {/* Header azioni */}
      <div className="flex items-center gap-3 flex-wrap">
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg
                       bg-blue-600 text-white text-sm hover:bg-blue-500
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving
              ? <><RefreshCw size={13} className="animate-spin" /> Salvataggio…</>
              : 'Salva configurazione'
            }
          </button>
        )}

        <button
          onClick={handleExport}
          disabled={exporting || dirty}
          title={dirty ? 'Salva prima di esportare' : 'Esporta modules.json e invia segnale MQTT reload'}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg
                     bg-emerald-700 text-white text-sm hover:bg-emerald-600
                     disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Upload size={13} />
          {exporting ? 'Esportazione...' : 'Esporta al motore'}
        </button>

        {saveResult === 'success' && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <CheckCircle size={13} /> Configurazione salvata
          </span>
        )}
        {saveResult === 'error' && (
          <span className="flex items-center gap-1.5 text-xs text-red-400">
            <AlertTriangle size={13} /> Errore salvataggio
          </span>
        )}
      </div>

      {/* Risultato export */}
      {exportResult && (
        <div className="bg-emerald-900/30 border border-emerald-800 rounded-lg p-3 text-sm">
          <p className="text-emerald-400 font-medium">
            Configurazione esportata ({exportResult.modules_count} moduli)
          </p>
          <p className="text-slate-400 text-xs mt-1">
            MQTT: {exportResult.mqtt_signal_sent ? 'Segnale reload inviato' : 'Non connesso'}
          </p>
        </div>
      )}

      {/* Lista moduli */}
      <div className="space-y-3">
        {effectiveModules.map(({ type, enabled, config }) => {
          const meta = MODULE_META[type] ?? { label: type, description: '', color: 'slate' };
          const colorOn = meta.color === 'blue' ? 'bg-blue-600' : 'bg-orange-600';
          const colorBadgeOn = meta.color === 'blue' ? 'bg-blue-500/20 text-blue-400' : 'bg-orange-500/20 text-orange-400';

          return (
            <div
              key={type}
              className={`bg-slate-900/50 border rounded-xl p-4 transition-colors
                ${enabled ? 'border-slate-700' : 'border-slate-800 opacity-70'}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <Package size={16} className={`shrink-0 mt-0.5 ${enabled ? 'text-slate-400' : 'text-slate-600'}`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white">{meta.label}</span>
                      <span className={`px-1.5 py-0.5 rounded text-xs font-mono ${colorBadgeOn} ${!enabled && 'opacity-50'}`}>
                        {type}
                      </span>
                      {enabled ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-400">
                          <Eye size={11} /> Attivo
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-slate-600">
                          <EyeOff size={11} /> Disattivo
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{meta.description}</p>
                  </div>
                </div>

                {/* Toggle */}
                <button
                  onClick={() => handleToggle(type)}
                  title={enabled ? 'Disabilita modulo' : 'Abilita modulo'}
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${enabled ? colorOn : 'bg-slate-700'}`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      enabled ? 'left-6' : 'left-1'
                    }`}
                  />
                </button>
              </div>

              {/* Config preview (solo se abilitato) */}
              {enabled && config && Object.keys(config).length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-800">
                  <p className="text-xs text-slate-600 mb-2">Configurazione</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
                    {Object.entries(config).map(([k, v]) => (
                      <div key={k} className="text-xs">
                        <span className="text-slate-600">{k}:</span>{' '}
                        <span className="text-slate-400 font-mono">
                          {v === null ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-slate-600">
        Dopo aver abilitato/disabilitato i moduli, salva e poi clicca "Esporta al motore"
        per propagare le modifiche al video analyzer via MQTT.
      </p>
    </div>
  );
}
