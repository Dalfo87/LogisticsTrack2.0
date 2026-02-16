/**
 * LogisticsTrack — ROI Editor Page
 * Editor visuale per le Region of Interest (Fase 5).
 *
 * Flusso:
 * 1. Seleziona camera → carica snapshot e ROI da DB
 * 2. Disegna poligoni sul canvas → salva come nuove ROI
 * 3. "Esporta al motore" → propaga le ROI al video analyzer via MQTT
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Layers,
  Plus,
  Trash2,
  Upload,
  X,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Camera,
} from 'lucide-react';
import {
  fetchCameras,
  fetchROIs,
  createROI,
  deleteROI,
  exportROIs,
  getCameraSnapshotUrl,
} from '../services/api';
import ROICanvas from '../components/ROICanvas/ROICanvas';

export default function ROIEditor() {
  // --- State ---
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [rois, setRois] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingCameras, setLoadingCameras] = useState(true);

  // Disegno
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawnPoints, setDrawnPoints] = useState(null);
  const [selectedRoiId, setSelectedRoiId] = useState(null);

  // Form nuova ROI
  const [formData, setFormData] = useState({
    name: '',
    aisle_id: '',
    is_active: true,
  });

  // Export
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);

  // Refresh snapshot
  const [snapshotKey, setSnapshotKey] = useState(0);

  // --- Caricamento iniziale camere ---
  useEffect(() => {
    const load = async () => {
      setLoadingCameras(true);
      try {
        const data = await fetchCameras();
        setCameras(data || []);
      } catch (err) {
        console.error('Errore caricamento camere:', err);
      } finally {
        setLoadingCameras(false);
      }
    };
    load();
  }, []);

  // --- Caricamento ROI quando cambia la camera ---
  const loadROIs = useCallback(async () => {
    if (!selectedCameraId) {
      setRois([]);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchROIs(selectedCameraId);
      setRois(data || []);
    } catch (err) {
      console.error('Errore caricamento ROI:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCameraId]);

  useEffect(() => {
    loadROIs();
    setSelectedRoiId(null);
    setIsDrawing(false);
    setDrawnPoints(null);
  }, [selectedCameraId, loadROIs]);

  // --- Handlers ---

  const handleCameraChange = (e) => {
    setSelectedCameraId(e.target.value);
    setSnapshotKey((k) => k + 1);
  };

  const handleStartDrawing = () => {
    setIsDrawing(true);
    setDrawnPoints(null);
    setSelectedRoiId(null);
  };

  const handleCancelDrawing = () => {
    setIsDrawing(false);
    setDrawnPoints(null);
  };

  const handleRoiCreated = (points) => {
    setDrawnPoints(points);
    setIsDrawing(false);
  };

  const handleRoiSelected = (roiId) => {
    if (!isDrawing) {
      setSelectedRoiId(roiId);
    }
  };

  const handleSaveROI = async (e) => {
    e.preventDefault();
    if (!drawnPoints || drawnPoints.length < 3) {
      alert('Disegna almeno 3 vertici per creare una ROI.');
      return;
    }
    if (!formData.name.trim()) {
      alert('Inserisci un nome per la ROI.');
      return;
    }

    try {
      await createROI({
        camera_id: selectedCameraId,
        name: formData.name.trim(),
        aisle_id: formData.aisle_id.trim() || formData.name.trim(),
        points: drawnPoints,
        is_active: formData.is_active,
      });
      setDrawnPoints(null);
      setFormData({ name: '', aisle_id: '', is_active: true });
      loadROIs();
    } catch (err) {
      alert(`Errore salvataggio ROI: ${err.message}`);
    }
  };

  const handleDeleteROI = async (roiId, roiName) => {
    if (!confirm(`Eliminare la ROI "${roiName}"?`)) return;
    try {
      await deleteROI(roiId);
      if (selectedRoiId === roiId) setSelectedRoiId(null);
      loadROIs();
    } catch (err) {
      alert(`Errore eliminazione ROI: ${err.message}`);
    }
  };

  const handleExport = async () => {
    if (!selectedCameraId) return;
    setExporting(true);
    setExportResult(null);
    try {
      const result = await exportROIs(selectedCameraId);
      setExportResult(result);
      setTimeout(() => setExportResult(null), 5000);
    } catch (err) {
      alert(`Errore export: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleRefreshSnapshot = () => {
    setSnapshotKey((k) => k + 1);
  };

  // Camera ID effettivo per snapshot (con key per forzare refresh)
  const effectiveCameraId = selectedCameraId ? `${selectedCameraId}` : null;

  // ROI da visualizzare sul canvas (incluso il poligono appena disegnato)
  const canvasRois = [
    ...rois,
    ...(drawnPoints
      ? [{ id: '__new__', name: 'Nuova ROI', points: drawnPoints, is_active: true }]
      : []),
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Layers size={20} className="text-blue-400" />
            ROI Editor
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Definisci le aree di interesse per il rilevamento muletti
          </p>
        </div>

        {/* Camera selector */}
        <div className="flex items-center gap-2">
          <Camera size={14} className="text-slate-500" />
          <select
            value={selectedCameraId}
            onChange={handleCameraChange}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5
                       text-sm text-slate-200 focus:outline-none focus:border-blue-500
                       min-w-[200px]"
          >
            <option value="">Seleziona camera...</option>
            {cameras.map((cam) => (
              <option key={cam.id} value={cam.id}>
                {cam.name} ({cam.id})
              </option>
            ))}
          </select>

          {selectedCameraId && (
            <button
              onClick={handleRefreshSnapshot}
              title="Aggiorna snapshot"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white
                         hover:bg-slate-800 transition-colors"
            >
              <RefreshCw size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Loading */}
      {loadingCameras && (
        <div className="text-center py-12 text-slate-600">Caricamento camere...</div>
      )}

      {/* Contenuto principale: Canvas + Sidebar */}
      {!loadingCameras && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Canvas (2/3 su desktop) */}
          <div className="lg:col-span-2">
            <ROICanvas
              key={snapshotKey}
              cameraId={effectiveCameraId}
              rois={canvasRois}
              selectedRoiId={selectedRoiId}
              onRoiCreated={handleRoiCreated}
              onRoiSelected={handleRoiSelected}
              isDrawing={isDrawing}
              onDrawingCancel={handleCancelDrawing}
            />
          </div>

          {/* Sidebar (1/3 su desktop) */}
          <div className="space-y-3">
            {/* Azioni */}
            {selectedCameraId && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={isDrawing ? handleCancelDrawing : handleStartDrawing}
                  disabled={!selectedCameraId}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                             bg-blue-600 text-white hover:bg-blue-500 transition-colors
                             disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isDrawing ? <X size={14} /> : <Plus size={14} />}
                  {isDrawing ? 'Annulla disegno' : 'Nuova ROI'}
                </button>

                <button
                  onClick={handleExport}
                  disabled={!selectedCameraId || rois.length === 0 || exporting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                             bg-emerald-600 text-white hover:bg-emerald-500 transition-colors
                             disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Upload size={14} />
                  {exporting ? 'Esportazione...' : 'Esporta al motore'}
                </button>
              </div>
            )}

            {/* Risultato export */}
            {exportResult && (
              <div className="bg-emerald-900/30 border border-emerald-800 rounded-lg p-3 text-sm">
                <p className="text-emerald-400 font-medium">
                  Esportate {exportResult.exported} ROI
                </p>
                <p className="text-slate-400 text-xs mt-1">
                  MQTT: {exportResult.mqtt_signal_sent ? 'Segnale inviato' : 'Non connesso'}
                </p>
              </div>
            )}

            {/* Form nuova ROI (visibile quando ci sono punti disegnati) */}
            {drawnPoints && (
              <form
                onSubmit={handleSaveROI}
                className="bg-slate-900/50 border border-blue-800/50 rounded-xl p-4 space-y-3"
              >
                <h3 className="text-sm font-medium text-blue-400">
                  Nuova ROI — {drawnPoints.length} vertici
                </h3>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">Nome *</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="es. Corsia A-01"
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5
                               text-sm text-slate-200 placeholder-slate-600
                               focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">ID Corsia</label>
                  <input
                    type="text"
                    value={formData.aisle_id}
                    onChange={(e) => setFormData({ ...formData, aisle_id: e.target.value })}
                    placeholder="es. A-01 (default: nome ROI)"
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5
                               text-sm text-slate-200 placeholder-slate-600
                               focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="rounded border-slate-600"
                  />
                  <label className="text-xs text-slate-400">Attiva</label>
                </div>

                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm
                               hover:bg-blue-500 transition-colors"
                  >
                    Salva ROI
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawnPoints(null)}
                    className="px-3 py-2 rounded-lg bg-slate-700 text-slate-300 text-sm
                               hover:bg-slate-600 transition-colors"
                  >
                    Scarta
                  </button>
                </div>
              </form>
            )}

            {/* Lista ROI esistenti */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
              <h3 className="text-sm font-medium text-slate-300 mb-3">
                ROI definite{' '}
                <span className="text-slate-600">
                  ({rois.length})
                </span>
              </h3>

              {loading ? (
                <p className="text-sm text-slate-600">Caricamento...</p>
              ) : !selectedCameraId ? (
                <p className="text-sm text-slate-600">
                  Seleziona una camera per vedere le ROI.
                </p>
              ) : rois.length === 0 ? (
                <p className="text-sm text-slate-600">
                  Nessuna ROI. Usa "Nuova ROI" per disegnarne una.
                </p>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                  {rois.map((roi) => (
                    <div
                      key={roi.id}
                      onClick={() => handleRoiSelected(roi.id)}
                      className={`rounded-lg p-3 cursor-pointer transition-all duration-150
                        ${
                          selectedRoiId === roi.id
                            ? 'bg-blue-900/30 border border-blue-700'
                            : 'bg-slate-800/50 border border-slate-800 hover:border-slate-700'
                        }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {roi.is_active ? (
                            <CheckCircle2 size={12} className="text-green-400" />
                          ) : (
                            <XCircle size={12} className="text-red-400/60" />
                          )}
                          <span className="text-sm text-white font-medium">{roi.name}</span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteROI(roi.id, roi.name);
                          }}
                          className="text-red-400/40 hover:text-red-400 transition-colors p-1"
                          title="Elimina ROI"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>

                      <div className="mt-1 text-xs text-slate-500 space-y-0.5">
                        <div>
                          <span className="text-slate-600">Corsia:</span>{' '}
                          <span className="font-mono text-slate-400">{roi.aisle_id}</span>
                        </div>
                        <div>
                          <span className="text-slate-600">Vertici:</span>{' '}
                          <span className="text-slate-400">{roi.points?.length || 0}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
