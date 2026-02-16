/**
 * LogisticsTrack — ROI Editor Page
 * Editor visuale per disegnare ROI poligonali.
 *
 * L'utente seleziona una camera, poi disegna poligoni cliccando sul canvas.
 * Le ROI vengono salvate nel database via API.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Pencil,
  Trash2,
  Save,
  Plus,
  X,
  MousePointer2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { fetchCameras, fetchRois, createRoi, deleteRoi } from '../services/api';

// Dimensione canvas di riferimento (coordinate ROI salvate relative a questo)
const CANVAS_W = 1280;
const CANVAS_H = 720;

const COLORS = [
  '#22c55e', '#3b82f6', '#eab308', '#ef4444', '#a855f7',
  '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#8b5cf6',
];

export default function ROIEditor() {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // State
  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [rois, setRois] = useState([]);
  const [loading, setLoading] = useState(false);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState([]);
  const [showRois, setShowRois] = useState(true);

  // Form per nuova ROI
  const [roiName, setRoiName] = useState('');
  const [roiAisle, setRoiAisle] = useState('');

  // Scale factor per canvas responsivo
  const [scale, setScale] = useState(1);

  // Carica camere
  useEffect(() => {
    fetchCameras().then(setCameras).catch(console.error);
  }, []);

  // Carica ROI quando cambia camera
  useEffect(() => {
    if (selectedCamera) {
      loadRois();
    } else {
      setRois([]);
    }
  }, [selectedCamera]);

  // Resize handler per canvas responsivo
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const containerW = containerRef.current.clientWidth;
        setScale(Math.min(containerW / CANVAS_W, 1));
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Ridisegna canvas quando cambiano ROI, punti correnti, o scale
  useEffect(() => {
    drawCanvas();
  }, [rois, currentPoints, showRois, scale]);

  const loadRois = async () => {
    try {
      const data = await fetchRois(selectedCamera);
      setRois(data || []);
    } catch (err) {
      console.error('Errore caricamento ROI:', err);
    }
  };

  // -----------------------------------------------------------------------
  // Canvas drawing
  // -----------------------------------------------------------------------

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = CANVAS_W * scale;
    const h = CANVAS_H * scale;
    canvas.width = w;
    canvas.height = h;

    // Sfondo scuro (placeholder per snapshot camera)
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    // Griglia guida
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 80 * scale) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 80 * scale) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Info dimensioni
    ctx.fillStyle = '#475569';
    ctx.font = `${12 * scale}px monospace`;
    ctx.fillText(`${CANVAS_W}×${CANVAS_H}px — ${selectedCamera || 'Seleziona camera'}`, 10 * scale, 20 * scale);

    // Disegna ROI salvate
    if (showRois) {
      rois.forEach((roi, idx) => {
        const color = COLORS[idx % COLORS.length];
        drawPolygon(ctx, roi.points, color, roi.name, 0.2);
      });
    }

    // Disegna poligono in corso
    if (currentPoints.length > 0) {
      // Linee
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      currentPoints.forEach((p, i) => {
        const x = p[0] * scale;
        const y = p[1] * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // Vertici
      currentPoints.forEach((p) => {
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(p[0] * scale, p[1] * scale, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }
  }, [rois, currentPoints, showRois, scale, selectedCamera]);

  const drawPolygon = (ctx, points, color, label, alpha) => {
    if (!points || points.length < 3) return;

    // Fill semi-trasparente
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = p[0] * scale;
      const y = p[1] * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();

    // Bordo
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = p[0] * scale;
      const y = p[1] * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();

    // Label
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.font = `bold ${13 * scale}px system-ui`;
    const labelX = points[0][0] * scale + 6;
    const labelY = points[0][1] * scale - 6;
    ctx.fillText(label, labelX, labelY);

    ctx.globalAlpha = 1;
  };

  // -----------------------------------------------------------------------
  // Interazione canvas
  // -----------------------------------------------------------------------

  const handleCanvasClick = (e) => {
    if (!isDrawing) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / scale);
    const y = Math.round((e.clientY - rect.top) / scale);

    setCurrentPoints((prev) => [...prev, [x, y]]);
  };

  const handleCanvasRightClick = (e) => {
    e.preventDefault();
    if (isDrawing && currentPoints.length > 0) {
      // Rimuovi ultimo punto
      setCurrentPoints((prev) => prev.slice(0, -1));
    }
  };

  // -----------------------------------------------------------------------
  // Azioni
  // -----------------------------------------------------------------------

  const startDrawing = () => {
    setIsDrawing(true);
    setCurrentPoints([]);
  };

  const cancelDrawing = () => {
    setIsDrawing(false);
    setCurrentPoints([]);
    setRoiName('');
    setRoiAisle('');
  };

  const saveRoi = async () => {
    if (currentPoints.length < 3) {
      alert('Servono almeno 3 punti per definire una ROI.');
      return;
    }
    if (!roiName.trim()) {
      alert('Inserisci un nome per la ROI.');
      return;
    }

    setLoading(true);
    try {
      await createRoi({
        camera_id: selectedCamera,
        name: roiName.trim(),
        aisle_id: roiAisle.trim() || roiName.trim(),
        points: currentPoints,
        is_active: true,
      });

      cancelDrawing();
      await loadRois();
    } catch (err) {
      alert(`Errore salvataggio ROI: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRoi = async (roiId) => {
    if (!confirm('Eliminare questa ROI?')) return;
    try {
      await deleteRoi(roiId);
      await loadRois();
    } catch (err) {
      alert(`Errore: ${err.message}`);
    }
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Editor ROI</h1>
        <p className="text-sm text-slate-500 mt-1">
          Disegna regioni di interesse sulle camere
        </p>
      </div>

      {/* Camera selector */}
      <div className="flex items-center gap-3">
        <select
          value={selectedCamera}
          onChange={(e) => {
            setSelectedCamera(e.target.value);
            cancelDrawing();
          }}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2
                     text-sm text-slate-200 focus:outline-none focus:border-blue-500"
        >
          <option value="">Seleziona camera...</option>
          {cameras.map((cam) => (
            <option key={cam.id} value={cam.id}>
              {cam.name} ({cam.id})
            </option>
          ))}
        </select>

        {selectedCamera && (
          <>
            <button
              onClick={() => setShowRois(!showRois)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs
                         transition-colors ${
                           showRois
                             ? 'bg-blue-600/20 text-blue-400'
                             : 'bg-slate-800 text-slate-500'
                         }`}
            >
              {showRois ? <Eye size={14} /> : <EyeOff size={14} />}
              ROI
            </button>

            {!isDrawing ? (
              <button
                onClick={startDrawing}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs
                           bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors"
              >
                <Plus size={14} />
                Nuova ROI
              </button>
            ) : (
              <button
                onClick={cancelDrawing}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs
                           bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
              >
                <X size={14} />
                Annulla
              </button>
            )}
          </>
        )}
      </div>

      {!selectedCamera && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-12 text-center text-slate-600">
          Seleziona una camera per iniziare a configurare le ROI.
        </div>
      )}

      {selectedCamera && (
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Canvas */}
          <div ref={containerRef} className="flex-1">
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              {isDrawing && (
                <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-xs text-amber-400">
                  <MousePointer2 size={12} className="inline mr-1" />
                  Clicca per aggiungere vertici. Tasto destro per annullare ultimo punto.
                  Minimo 3 punti.
                </div>
              )}
              <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                onContextMenu={handleCanvasRightClick}
                className={`${isDrawing ? 'cursor-crosshair' : 'cursor-default'}`}
                style={{ display: 'block', width: '100%', height: 'auto' }}
              />
            </div>

            {/* Form salvataggio (visibile durante disegno) */}
            {isDrawing && currentPoints.length >= 3 && (
              <div className="mt-3 bg-slate-900/50 border border-slate-800 rounded-xl p-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-500">Nome ROI *</label>
                    <input
                      type="text"
                      value={roiName}
                      onChange={(e) => setRoiName(e.target.value)}
                      placeholder="es. Corsia A-01"
                      className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5
                                 text-sm text-slate-200 placeholder-slate-600
                                 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-500">Corsia (aisle_id)</label>
                    <input
                      type="text"
                      value={roiAisle}
                      onChange={(e) => setRoiAisle(e.target.value)}
                      placeholder="es. A-01"
                      className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5
                                 text-sm text-slate-200 placeholder-slate-600
                                 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={saveRoi}
                      disabled={loading || !roiName.trim()}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm
                                 bg-blue-600 text-white hover:bg-blue-500
                                 disabled:opacity-50 transition-colors w-full justify-center"
                    >
                      <Save size={14} />
                      Salva ROI ({currentPoints.length} vertici)
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Lista ROI sidebar */}
          <div className="lg:w-72">
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">
                ROI ({rois.length})
              </h3>
              {rois.length === 0 ? (
                <p className="text-xs text-slate-600">
                  Nessuna ROI per questa camera.
                </p>
              ) : (
                <div className="space-y-2">
                  {rois.map((roi, idx) => (
                    <div
                      key={roi.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-slate-800/50"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                        />
                        <div>
                          <div className="text-sm text-slate-200">{roi.name}</div>
                          <div className="text-xs text-slate-500">
                            {roi.aisle_id} — {roi.points.length} vertici
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteRoi(roi.id)}
                        className="text-red-400/50 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
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
