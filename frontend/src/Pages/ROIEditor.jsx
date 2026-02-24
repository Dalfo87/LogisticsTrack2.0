/**
 * LogisticsTrack — ROI Editor Page
 * Editor visuale per le Region of Interest.
 *
 * Flusso:
 * 1. Seleziona camera → carica snapshot e ROI da DB
 * 2. Disegna nuovi poligoni sul canvas → salva come nuove ROI
 * 3. Seleziona ROI esistente → modifica proprietà o vertici
 * 4. "Esporta al motore" → propaga le ROI al video analyzer via MQTT
 *
 * Feature:
 * - Modifica proprietà ROI (nome, aisle_id, attiva)
 * - Modifica vertici via drag sul canvas
 * - Toggle active dalla lista
 * - Snap a griglia togglable
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
  Edit3,
  Save,
  RotateCcw,
  Grid,
  Check,
  AlertTriangle,
} from 'lucide-react';
import {
  fetchCameras,
  fetchROIs,
  createROI,
  updateROI,
  deleteROI,
  exportROIs,
  getCameraSnapshotUrl,
} from '../services/api';
import ROICanvas from '../components/ROICanvas/ROICanvas';

// ─── Helpers ────────────────────────────────────────────────────────────────

const SNAP_GRID_PX = 20; // griglia snap in pixel logici canvas

export default function ROIEditor() {
  // ── State: camere e ROI ──
  const [cameras, setCameras]               = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [rois, setRois]                     = useState([]);
  const [loading, setLoading]               = useState(false);
  const [loadingCameras, setLoadingCameras] = useState(true);

  // ── State: disegno nuova ROI ──
  const [isDrawing, setIsDrawing]           = useState(false);
  const [drawnPoints, setDrawnPoints]       = useState(null);
  const [newRoiForm, setNewRoiForm]         = useState({ name: '', aisle_id: '', is_active: true });

  // ── State: ROI selezionata / modifica proprietà ──
  const [selectedRoiId, setSelectedRoiId]   = useState(null);
  const [editFormData, setEditFormData]     = useState(null); // { name, aisle_id, is_active }
  const [editFormSaving, setEditFormSaving] = useState(false);
  const [editFormResult, setEditFormResult] = useState(null); // 'success' | 'error' | null

  // ── State: modifica vertici ──
  const [editMode, setEditMode]             = useState(null);    // 'vertices' | null
  const [editedPoints, setEditedPoints]     = useState(null);    // punti correnti durante l'edit
  const [editSaving, setEditSaving]         = useState(false);

  // ── State: snap + export + snapshot ──
  const [snapEnabled, setSnapEnabled]       = useState(false);
  const [exporting, setExporting]           = useState(false);
  const [exportResult, setExportResult]     = useState(null);
  const [snapshotKey, setSnapshotKey]       = useState(0);

  // ── ROI selezionata (oggetto) ──
  const selectedRoi = rois.find((r) => r.id === selectedRoiId) ?? null;

  // ── Caricamento camere ──
  useEffect(() => {
    (async () => {
      setLoadingCameras(true);
      try {
        const data = await fetchCameras();
        setCameras(data || []);
      } catch (err) {
        console.error('Errore caricamento camere:', err);
      } finally {
        setLoadingCameras(false);
      }
    })();
  }, []);

  // ── Caricamento ROI per camera ──
  const loadROIs = useCallback(async () => {
    if (!selectedCameraId) { setRois([]); return; }
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
    setEditFormData(null);
    setEditMode(null);
    setEditedPoints(null);
    setIsDrawing(false);
    setDrawnPoints(null);
  }, [selectedCameraId, loadROIs]);

  // ── Handlers: camera ──
  const handleCameraChange = (e) => {
    setSelectedCameraId(e.target.value);
    setSnapshotKey((k) => k + 1);
  };

  // ── Handlers: disegno nuova ROI ──
  const handleStartDrawing = () => {
    setIsDrawing(true);
    setDrawnPoints(null);
    // Deseleziona e chiude eventuale edit
    setSelectedRoiId(null);
    setEditFormData(null);
    setEditMode(null);
    setEditedPoints(null);
  };

  const handleCancelDrawing = () => {
    setIsDrawing(false);
    setDrawnPoints(null);
  };

  const handleRoiCreated = (points) => {
    setDrawnPoints(points);
    setIsDrawing(false);
  };

  const handleSaveNewROI = async (e) => {
    e.preventDefault();
    if (!drawnPoints || drawnPoints.length < 3) {
      alert('Disegna almeno 3 vertici per creare una ROI.');
      return;
    }
    if (!newRoiForm.name.trim()) {
      alert('Inserisci un nome per la ROI.');
      return;
    }
    try {
      await createROI({
        camera_id: selectedCameraId,
        name: newRoiForm.name.trim(),
        aisle_id: newRoiForm.aisle_id.trim() || newRoiForm.name.trim(),
        points: drawnPoints,
        is_active: newRoiForm.is_active,
      });
      setDrawnPoints(null);
      setNewRoiForm({ name: '', aisle_id: '', is_active: true });
      loadROIs();
    } catch (err) {
      alert(`Errore salvataggio ROI: ${err.message}`);
    }
  };

  // ── Handlers: selezione ROI e modifica proprietà ──
  const handleRoiSelected = (roiId) => {
    if (isDrawing || editMode === 'vertices') return;
    setSelectedRoiId(roiId);
    if (roiId) {
      const roi = rois.find((r) => r.id === roiId);
      if (roi) {
        setEditFormData({
          name: roi.name || '',
          aisle_id: roi.aisle_id || '',
          is_active: roi.is_active !== false,
        });
        setEditFormResult(null);
      }
    } else {
      setEditFormData(null);
    }
    setEditMode(null);
    setEditedPoints(null);
  };

  const handleSaveEditProps = async () => {
    if (!selectedRoiId || !editFormData || !selectedRoi) return;
    setEditFormSaving(true);
    setEditFormResult(null);
    try {
      await updateROI(selectedRoiId, {
        camera_id: selectedRoi.camera_id,
        name: editFormData.name.trim(),
        aisle_id: editFormData.aisle_id.trim() || editFormData.name.trim(),
        points: selectedRoi.points,
        is_active: editFormData.is_active,
      });
      setEditFormResult('success');
      loadROIs();
      setTimeout(() => setEditFormResult(null), 2500);
    } catch (err) {
      setEditFormResult('error');
      setTimeout(() => setEditFormResult(null), 3000);
    } finally {
      setEditFormSaving(false);
    }
  };

  // ── Handlers: toggle active dalla lista ──
  const handleToggleActive = async (roi, e) => {
    e.stopPropagation();
    try {
      await updateROI(roi.id, {
        camera_id: roi.camera_id,
        name: roi.name,
        aisle_id: roi.aisle_id,
        points: roi.points,
        is_active: !roi.is_active,
      });
      loadROIs();
    } catch (err) {
      alert(`Errore aggiornamento ROI: ${err.message}`);
    }
  };

  // ── Handlers: modifica vertici ──
  const handleStartVertexEdit = () => {
    if (!selectedRoi) return;
    setEditMode('vertices');
    setEditedPoints(selectedRoi.points.map((p) => [...p]));
  };

  const handleCancelVertexEdit = () => {
    setEditMode(null);
    setEditedPoints(null);
  };

  const handleConfirmVertexEdit = async () => {
    if (!selectedRoiId || !editedPoints || !selectedRoi) return;
    setEditSaving(true);
    try {
      await updateROI(selectedRoiId, {
        camera_id: selectedRoi.camera_id,
        name: selectedRoi.name,
        aisle_id: selectedRoi.aisle_id,
        points: editedPoints,
        is_active: selectedRoi.is_active,
      });
      setEditMode(null);
      setEditedPoints(null);
      loadROIs();
    } catch (err) {
      alert(`Errore salvataggio vertici: ${err.message}`);
    } finally {
      setEditSaving(false);
    }
  };

  const handleVerticesChanged = useCallback((newPoints) => {
    setEditedPoints(newPoints);
  }, []);

  // ── Handlers: elimina ROI ──
  const handleDeleteROI = async (roiId, roiName) => {
    if (!confirm(`Eliminare la ROI "${roiName}"?`)) return;
    try {
      await deleteROI(roiId);
      if (selectedRoiId === roiId) {
        setSelectedRoiId(null);
        setEditFormData(null);
        setEditMode(null);
        setEditedPoints(null);
      }
      loadROIs();
    } catch (err) {
      alert(`Errore eliminazione ROI: ${err.message}`);
    }
  };

  // ── Handlers: export + snapshot ──
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

  // ── Canvas props ──
  const effectiveCameraId = selectedCameraId || null;
  const canvasRois = [
    ...rois,
    ...(drawnPoints
      ? [{ id: '__new__', name: 'Nuova ROI', points: drawnPoints, is_active: true }]
      : []),
  ];
  // In vertex edit mode, passa la ROI selezionata come editRoi
  const editRoiForCanvas = editMode === 'vertices' ? selectedRoi : null;

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
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
              onClick={() => setSnapshotKey((k) => k + 1)}
              title="Aggiorna snapshot"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <RefreshCw size={14} />
            </button>
          )}
        </div>
      </div>

      {loadingCameras && (
        <div className="text-center py-12 text-slate-600">Caricamento camere...</div>
      )}

      {!loadingCameras && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* ── Canvas (2/3 su desktop) ── */}
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
              editRoi={editRoiForCanvas}
              editMode={editMode}
              snapGrid={snapEnabled ? SNAP_GRID_PX : 0}
              onVerticesChanged={handleVerticesChanged}
            />
          </div>

          {/* ── Sidebar (1/3 su desktop) ── */}
          <div className="space-y-3">

            {/* Toolbar azioni */}
            {selectedCameraId && (
              <div className="flex flex-wrap gap-2">
                {/* Nuova ROI / Annulla */}
                <button
                  onClick={isDrawing ? handleCancelDrawing : handleStartDrawing}
                  disabled={!selectedCameraId || editMode === 'vertices'}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                             bg-blue-600 text-white hover:bg-blue-500 transition-colors
                             disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isDrawing ? <X size={14} /> : <Plus size={14} />}
                  {isDrawing ? 'Annulla disegno' : 'Nuova ROI'}
                </button>

                {/* Esporta */}
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

                {/* Snap toggle */}
                <button
                  onClick={() => setSnapEnabled((v) => !v)}
                  title={`Snap a griglia ${SNAP_GRID_PX}px (${snapEnabled ? 'attivo' : 'disattivo'})`}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                              border transition-colors
                              ${snapEnabled
                                ? 'bg-violet-600/20 border-violet-500/50 text-violet-300'
                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                              }`}
                >
                  <Grid size={14} />
                  Snap {snapEnabled ? 'ON' : 'OFF'}
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

            {/* Form nuova ROI */}
            {drawnPoints && (
              <form
                onSubmit={handleSaveNewROI}
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
                    value={newRoiForm.name}
                    onChange={(e) => setNewRoiForm({ ...newRoiForm, name: e.target.value })}
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
                    value={newRoiForm.aisle_id}
                    onChange={(e) => setNewRoiForm({ ...newRoiForm, aisle_id: e.target.value })}
                    placeholder="es. A-01 (default: nome ROI)"
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5
                               text-sm text-slate-200 placeholder-slate-600
                               focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="new-active"
                    checked={newRoiForm.is_active}
                    onChange={(e) => setNewRoiForm({ ...newRoiForm, is_active: e.target.checked })}
                    className="rounded border-slate-600"
                  />
                  <label htmlFor="new-active" className="text-xs text-slate-400">Attiva</label>
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

            {/* Pannello modifica ROI selezionata */}
            {selectedRoi && !drawnPoints && editMode !== 'vertices' && (
              <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-slate-200 flex items-center gap-2">
                    <Edit3 size={13} className="text-blue-400" />
                    Modifica ROI
                  </h3>
                  <button
                    onClick={() => { setSelectedRoiId(null); setEditFormData(null); }}
                    className="text-slate-600 hover:text-slate-400 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Nome */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">Nome</label>
                  <input
                    type="text"
                    value={editFormData?.name ?? ''}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, name: e.target.value })
                    }
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5
                               text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                  />
                </div>

                {/* ID Corsia */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">ID Corsia</label>
                  <input
                    type="text"
                    value={editFormData?.aisle_id ?? ''}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, aisle_id: e.target.value })
                    }
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5
                               text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                  />
                </div>

                {/* Toggle attiva */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Attiva</span>
                  <button
                    onClick={() =>
                      setEditFormData({ ...editFormData, is_active: !editFormData.is_active })
                    }
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      editFormData?.is_active ? 'bg-blue-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                        editFormData?.is_active ? 'left-5' : 'left-0.5'
                      }`}
                    />
                  </button>
                </div>

                {/* Salva proprietà */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveEditProps}
                    disabled={editFormSaving}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                               bg-blue-600 text-white hover:bg-blue-500 transition-colors
                               disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {editFormSaving
                      ? <><RefreshCw size={12} className="animate-spin" /> Salvataggio…</>
                      : <><Save size={12} /> Salva proprietà</>
                    }
                  </button>
                  {editFormResult === 'success' && (
                    <span className="text-xs text-emerald-400 flex items-center gap-1">
                      <Check size={12} /> Salvato
                    </span>
                  )}
                  {editFormResult === 'error' && (
                    <span className="text-xs text-red-400 flex items-center gap-1">
                      <AlertTriangle size={12} /> Errore
                    </span>
                  )}
                </div>

                {/* Modifica vertici */}
                <div className="border-t border-slate-800 pt-3">
                  <button
                    onClick={handleStartVertexEdit}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm
                               rounded-lg border border-slate-700 text-slate-300
                               hover:bg-slate-800 hover:border-slate-600 transition-colors"
                  >
                    <Edit3 size={13} />
                    Modifica vertici
                    <span className="text-slate-600 text-xs">({selectedRoi.points?.length ?? 0} pt)</span>
                  </button>
                </div>
              </div>
            )}

            {/* Toolbar vertex edit */}
            {editMode === 'vertices' && (
              <div className="bg-slate-900/50 border border-amber-800/50 rounded-xl p-4 space-y-3">
                <p className="text-xs text-amber-400 flex items-center gap-2">
                  <Edit3 size={13} />
                  Modalità modifica vertici — trascina i punti sul canvas
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleConfirmVertexEdit}
                    disabled={editSaving}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm
                               rounded-lg bg-emerald-700 text-white hover:bg-emerald-600
                               transition-colors disabled:opacity-50"
                  >
                    {editSaving
                      ? <><RefreshCw size={12} className="animate-spin" /> Salvataggio…</>
                      : <><Check size={13} /> Salva vertici</>
                    }
                  </button>
                  <button
                    onClick={handleCancelVertexEdit}
                    className="px-3 py-2 rounded-lg border border-slate-700 text-slate-400
                               hover:bg-slate-800 transition-colors text-sm"
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
                {editedPoints && (
                  <p className="text-xs text-slate-600 text-center">
                    {editedPoints.length} vertici
                  </p>
                )}
              </div>
            )}

            {/* Lista ROI */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
              <h3 className="text-sm font-medium text-slate-300 mb-3">
                ROI definite{' '}
                <span className="text-slate-600">({rois.length})</span>
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
                        ${selectedRoiId === roi.id
                          ? 'bg-blue-900/30 border border-blue-700'
                          : 'bg-slate-800/50 border border-slate-800 hover:border-slate-700'
                        }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          {/* Toggle attivo inline */}
                          <button
                            onClick={(e) => handleToggleActive(roi, e)}
                            title={roi.is_active ? 'Disattiva' : 'Attiva'}
                            className="shrink-0"
                          >
                            {roi.is_active
                              ? <CheckCircle2 size={13} className="text-green-400 hover:text-green-300" />
                              : <XCircle size={13} className="text-slate-500 hover:text-slate-400" />
                            }
                          </button>
                          <span className={`text-sm font-medium truncate ${
                            roi.is_active ? 'text-white' : 'text-slate-500'
                          }`}>
                            {roi.name}
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteROI(roi.id, roi.name);
                          }}
                          className="text-red-400/40 hover:text-red-400 transition-colors p-1 shrink-0 ml-1"
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
                          {!roi.is_active && (
                            <span className="ml-2 text-slate-600">[disattiva]</span>
                          )}
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
