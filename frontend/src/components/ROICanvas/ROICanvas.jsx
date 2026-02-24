/**
 * LogisticsTrack — ROI Canvas
 * Canvas HTML5 interattivo per disegnare e modificare poligoni ROI.
 *
 * Modalità:
 *  - Visualizzazione/selezione (default)
 *  - Disegno nuova ROI (isDrawing=true)
 *  - Modifica vertici ROI esistente (editMode='vertices')
 *
 * Funzionalità:
 *  - Snap a griglia configurabile (snapGrid prop)
 *  - Drag vertici: mousedown → drag → mouseup → onVerticesChanged
 *  - Doppio click su vertice (in editMode) per eliminarlo (min. 3 vertici)
 *  - ROI disattive: bordo tratteggiato, semitrasparente
 */
import { useRef, useEffect, useState, useCallback } from 'react';
import { getCameraSnapshotUrl } from '../../services/api';

// Dimensioni logiche del canvas (corrispondono alla risoluzione del frame)
const CANVAS_W = 1280;
const CANVAS_H = 720;

// Colori base [R, G, B] per palette ciclica
const ROI_BASE_COLORS = [
  [0, 255, 100],
  [100, 200, 255],
  [255, 255, 0],
  [255, 100, 100],
  [200, 100, 255],
  [255, 180, 50],
];

function getRoiRgb(roi, idx) {
  // Usa colore personalizzato se presente (futura feature con DB migration)
  if (roi.color && Array.isArray(roi.color) && roi.color.length >= 3) {
    return roi.color;
  }
  return ROI_BASE_COLORS[idx % ROI_BASE_COLORS.length];
}

/**
 * @param {Object} props
 * @param {string|null} props.cameraId
 * @param {Array}  props.rois          - [{id, name, points, is_active}]
 * @param {number|null} props.selectedRoiId
 * @param {Function} props.onRoiCreated  - (points) => void
 * @param {Function} props.onRoiSelected - (roiId) => void
 * @param {boolean} props.isDrawing
 * @param {Function} props.onDrawingCancel
 * @param {Object|null} props.editRoi    - ROI in edit-vertices mode (object, not updated during drag)
 * @param {string|null} props.editMode   - 'vertices' | null
 * @param {number} props.snapGrid        - snap step in logical px (0 = disabled)
 * @param {Function} props.onVerticesChanged - (newPoints) => void, called on mouseup
 */
export default function ROICanvas({
  cameraId,
  rois = [],
  selectedRoiId = null,
  onRoiCreated,
  onRoiSelected,
  isDrawing = false,
  onDrawingCancel,
  editRoi = null,
  editMode = null,
  snapGrid = 0,
  onVerticesChanged,
}) {
  const canvasRef       = useRef(null);
  const [bgImage, setBgImage]           = useState(null);
  const [currentPoints, setCurrentPoints] = useState([]);
  const [mousePos, setMousePos]         = useState(null);
  const [snapshotError, setSnapshotError] = useState(false);

  // Vertex edit state
  const [editPoints, setEditPoints]     = useState(null);   // [[x,y], ...]
  const draggingRef                     = useRef(null);      // vertex index being dragged, or null
  const editPointsRef                   = useRef(null);      // mirror for window listener

  // Keep ref in sync
  useEffect(() => { editPointsRef.current = editPoints; }, [editPoints]);

  // -----------------------------------------------------------------
  // Carica snapshot camera
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!cameraId) { setBgImage(null); return; }
    setSnapshotError(false);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => { setBgImage(img); setSnapshotError(false); };
    img.onerror = () => { setBgImage(null); setSnapshotError(true); };
    img.src = `${getCameraSnapshotUrl(cameraId)}?t=${Date.now()}`;
  }, [cameraId]);

  // -----------------------------------------------------------------
  // Inizializza editPoints quando si entra in editMode (non su ogni update)
  // -----------------------------------------------------------------
  useEffect(() => {
    if (editMode === 'vertices' && editRoi) {
      setEditPoints(editRoi.points.map((p) => [p[0], p[1]]));
      draggingRef.current = null;
    } else {
      setEditPoints(null);
      draggingRef.current = null;
    }
  }, [editMode, editRoi?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // -----------------------------------------------------------------
  // Rilascio drag se il mouse va fuori dalla finestra
  // -----------------------------------------------------------------
  useEffect(() => {
    const handleWindowMouseUp = () => {
      if (draggingRef.current !== null) {
        const pts = editPointsRef.current;
        if (pts) onVerticesChanged?.(pts);
        draggingRef.current = null;
      }
    };
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  }, [onVerticesChanged]);

  // -----------------------------------------------------------------
  // Conversione coordinate mouse → canvas logico + snap
  // -----------------------------------------------------------------
  const toCanvasCoords = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    let x = Math.round((e.clientX - rect.left) * scaleX);
    let y = Math.round((e.clientY - rect.top) * scaleY);
    if (snapGrid > 0) {
      x = Math.round(x / snapGrid) * snapGrid;
      y = Math.round(y / snapGrid) * snapGrid;
    }
    return { x, y };
  }, [snapGrid]);

  // -----------------------------------------------------------------
  // Helper: distanza punto → vertice
  // -----------------------------------------------------------------
  const nearVertexIdx = useCallback((pt, points, threshold = 15) => {
    if (!points) return -1;
    for (let i = 0; i < points.length; i++) {
      const dx = pt.x - points[i][0];
      const dy = pt.y - points[i][1];
      if (Math.sqrt(dx * dx + dy * dy) < threshold) return i;
    }
    return -1;
  }, []);

  // -----------------------------------------------------------------
  // Verifica chiusura poligono (primo punto)
  // -----------------------------------------------------------------
  const isNearFirstPoint = useCallback((pt) => {
    if (currentPoints.length < 3) return false;
    const first = currentPoints[0];
    const dx = pt.x - first[0];
    const dy = pt.y - first[1];
    return Math.sqrt(dx * dx + dy * dy) < 20;
  }, [currentPoints]);

  // -----------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------

  const handleMouseDown = useCallback((e) => {
    if (editMode !== 'vertices' || !editPoints) return;
    const pt = toCanvasCoords(e);
    if (!pt) return;
    const idx = nearVertexIdx(pt, editPoints);
    if (idx >= 0) {
      draggingRef.current = idx;
      e.preventDefault(); // prevent text selection
    }
  }, [editMode, editPoints, toCanvasCoords, nearVertexIdx]);

  const handleMouseMove = useCallback((e) => {
    const pt = toCanvasCoords(e);

    // Aggiorna mouse position per overlay coordinate
    setMousePos((isDrawing || editMode === 'vertices') ? pt : null);

    // Drag vertex in edit mode
    if (editMode === 'vertices' && draggingRef.current !== null && editPoints && pt) {
      setEditPoints((prev) => {
        const next = prev.map((p) => [...p]);
        next[draggingRef.current] = [pt.x, pt.y];
        return next;
      });
    }
  }, [editMode, editPoints, isDrawing, toCanvasCoords]);

  const handleMouseUp = useCallback(() => {
    if (draggingRef.current !== null && editPoints) {
      onVerticesChanged?.(editPoints);
      draggingRef.current = null;
    }
  }, [editPoints, onVerticesChanged]);

  const handleClick = useCallback((e) => {
    if (editMode === 'vertices') return; // no click-to-add in edit mode

    if (!isDrawing) {
      // Modalità selezione
      const pt = toCanvasCoords(e);
      if (!pt) return;
      for (const roi of rois) {
        if (isPointInPolygon(pt, roi.points)) {
          onRoiSelected?.(roi.id);
          return;
        }
      }
      onRoiSelected?.(null);
      return;
    }

    // Modalità disegno: aggiungi vertice
    const pt = toCanvasCoords(e);
    if (!pt) return;
    if (isNearFirstPoint(pt)) {
      const finalPoints = [...currentPoints];
      setCurrentPoints([]);
      onRoiCreated?.(finalPoints);
      return;
    }
    setCurrentPoints((prev) => [...prev, [pt.x, pt.y]]);
  }, [editMode, isDrawing, toCanvasCoords, currentPoints, isNearFirstPoint, onRoiCreated, onRoiSelected, rois]);

  const handleDoubleClick = useCallback((e) => {
    if (editMode === 'vertices' && editPoints) {
      // Elimina vertice se ≥ 4 punti
      if (editPoints.length <= 3) return;
      const pt = toCanvasCoords(e);
      if (!pt) return;
      const idx = nearVertexIdx(pt, editPoints);
      if (idx >= 0) {
        e.preventDefault();
        const newPoints = editPoints.filter((_, i) => i !== idx);
        setEditPoints(newPoints);
        onVerticesChanged?.(newPoints);
      }
      return;
    }

    if (!isDrawing || currentPoints.length < 3) return;
    e.preventDefault();
    const finalPoints = [...currentPoints];
    setCurrentPoints([]);
    onRoiCreated?.(finalPoints);
  }, [editMode, editPoints, isDrawing, currentPoints, onRoiCreated, toCanvasCoords, nearVertexIdx, onVerticesChanged]);

  // Esc per annullare disegno
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isDrawing) {
        setCurrentPoints([]);
        onDrawingCancel?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDrawing, onDrawingCancel]);

  // Reset punti se si disattiva la modalità disegno
  useEffect(() => {
    if (!isDrawing) setCurrentPoints([]);
  }, [isDrawing]);

  // -----------------------------------------------------------------
  // Rendering canvas
  // -----------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // ── Sfondo ──
    if (bgImage) {
      ctx.drawImage(bgImage, 0, 0, CANVAS_W, CANVAS_H);
    } else {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.strokeStyle = 'rgba(100, 100, 140, 0.15)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= CANVAS_W; x += 80) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke();
      }
      for (let y = 0; y <= CANVAS_H; y += 80) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
      }
      ctx.fillStyle = snapshotError ? '#ef4444' : '#64748b';
      ctx.font = '18px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(
        snapshotError
          ? 'Snapshot non disponibile — camera offline'
          : cameraId ? 'Caricamento snapshot...' : 'Seleziona una camera per iniziare',
        CANVAS_W / 2, CANVAS_H / 2
      );
      ctx.textAlign = 'start';
    }

    // ── Snap grid indicator ──
    if (snapGrid >= 10 && (isDrawing || editMode === 'vertices')) {
      ctx.fillStyle = 'rgba(59, 130, 246, 0.25)';
      for (let x = 0; x <= CANVAS_W; x += snapGrid) {
        for (let y = 0; y <= CANVAS_H; y += snapGrid) {
          ctx.fillRect(x - 1, y - 1, 2, 2);
        }
      }
    }

    // ── ROI esistenti ──
    rois.forEach((roi, i) => {
      // La ROI in edit-mode viene disegnata separatamente dopo
      if (editMode === 'vertices' && editRoi && roi.id === editRoi.id) return;

      const [r, g, b] = getRoiRgb(roi, i);
      const isSelected = roi.id === selectedRoiId;
      const isActive   = roi.is_active !== false;

      drawPolygon(ctx, roi.points, {
        strokeColor: isActive ? `rgba(${r},${g},${b},0.7)` : 'rgba(100,100,100,0.4)',
        fillColor: isSelected
          ? 'rgba(59,130,246,0.15)'
          : isActive ? `rgba(${r},${g},${b},0.08)` : 'rgba(50,50,50,0.05)',
        lineWidth: isSelected ? 3 : 2,
        dashed: !isActive,
      });

      if (roi.points?.length > 0) {
        const labelPt = getPolygonCenter(roi.points);
        ctx.fillStyle = isActive ? '#e2e8f0' : '#64748b';
        ctx.font = isSelected ? 'bold 14px system-ui' : '13px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(roi.name, labelPt[0], labelPt[1]);
        ctx.textAlign = 'start';
      }
    });

    // ── ROI in modifica vertici ──
    if (editMode === 'vertices' && editRoi && editPoints) {
      const pts = editPoints;
      const editRoiIdx = rois.findIndex((r) => r.id === editRoi.id);
      const [r, g, b] = getRoiRgb(editRoi, editRoiIdx >= 0 ? editRoiIdx : 0);

      // Poligono
      drawPolygon(ctx, pts, {
        strokeColor: `rgba(${r},${g},${b},0.95)`,
        fillColor:   `rgba(${r},${g},${b},0.12)`,
        lineWidth: 2.5,
      });

      // Label
      if (pts.length > 0) {
        const lp = getPolygonCenter(pts);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 14px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(editRoi.name, lp[0], lp[1]);
        ctx.textAlign = 'start';
      }

      // Vertex handles
      pts.forEach((pt, i) => {
        const isDragged = draggingRef.current === i;
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], isDragged ? 11 : 7, 0, Math.PI * 2);
        ctx.fillStyle = isDragged ? '#f59e0b' : '#3b82f6';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Indice vertice
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 9px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(i.toString(), pt[0], pt[1] + 3.5);
        ctx.textAlign = 'start';
      });

      // Midpoint hints (click to insert — visual only for now)
      ctx.setLineDash([]);
    }

    // ── Poligono in disegno ──
    if (isDrawing && currentPoints.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.moveTo(currentPoints[0][0], currentPoints[0][1]);
      for (let i = 1; i < currentPoints.length; i++) {
        ctx.lineTo(currentPoints[i][0], currentPoints[i][1]);
      }
      if (mousePos) {
        ctx.setLineDash([8, 4]);
        ctx.lineTo(mousePos.x, mousePos.y);
        ctx.setLineDash([]);
      }
      ctx.stroke();

      currentPoints.forEach((pt, i) => {
        ctx.beginPath();
        ctx.fillStyle = i === 0 ? '#22c55e' : '#3b82f6';
        ctx.arc(pt[0], pt[1], i === 0 ? 8 : 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      if (mousePos && isNearFirstPoint(mousePos)) {
        ctx.beginPath();
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.arc(currentPoints[0][0], currentPoints[0][1], 15, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // ── Istruzioni (banner inferiore) ──
    const showBanner = isDrawing || editMode === 'vertices';
    if (showBanner) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, CANVAS_H - 36, CANVAS_W, 36);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '13px system-ui';
      if (editMode === 'vertices') {
        ctx.fillText(
          '  Trascina i vertici • Doppio-click su un vertice per eliminarlo (min. 3) • Salva per confermare',
          10, CANVAS_H - 12
        );
      } else {
        ctx.fillText(
          currentPoints.length === 0
            ? '  Click per aggiungere vertici • Doppio-click o click sul primo punto per chiudere • Esc per annullare'
            : `  ${currentPoints.length} vertici${currentPoints.length >= 3 ? ' • Doppio-click o click sul punto verde per chiudere' : ' (min. 3)'} • Esc annulla`,
          10, CANVAS_H - 12
        );
      }
    }

    // ── Overlay coordinate mouse ──
    if ((isDrawing || editMode === 'vertices') && mousePos) {
      const coordText = `${mousePos.x}, ${mousePos.y}`;
      ctx.font = '12px monospace';
      const tw = ctx.measureText(coordText).width;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(CANVAS_W - tw - 24, 0, tw + 24, 28);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(coordText, CANVAS_W - tw - 12, 18);
    }

  }, [
    bgImage, rois, selectedRoiId, isDrawing, currentPoints, mousePos,
    snapshotError, cameraId, isNearFirstPoint, editMode, editRoi,
    editPoints, snapGrid,
  ]);

  // -----------------------------------------------------------------
  // Cursor style
  // -----------------------------------------------------------------
  let cursor = 'default';
  if (isDrawing)             cursor = 'crosshair';
  else if (editMode === 'vertices') cursor = 'grab';

  return (
    <div className="relative w-full">
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        className="w-full rounded-lg border border-slate-700 bg-slate-900"
        style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}`, cursor }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function drawPolygon(ctx, points, { strokeColor, fillColor, lineWidth = 2, dashed = false } = {}) {
  if (!points || points.length < 3) return;
  ctx.beginPath();
  ctx.setLineDash(dashed ? [6, 4] : []);
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  if (fillColor) { ctx.fillStyle = fillColor; ctx.fill(); }
  ctx.strokeStyle = strokeColor || '#fff';
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.setLineDash([]);
}

function getPolygonCenter(points) {
  if (!points || points.length === 0) return [0, 0];
  const sumX = points.reduce((s, p) => s + p[0], 0);
  const sumY = points.reduce((s, p) => s + p[1], 0);
  return [sumX / points.length, sumY / points.length];
}

function isPointInPolygon(pt, polygon) {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
