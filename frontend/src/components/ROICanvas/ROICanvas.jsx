/**
 * LogisticsTrack — ROI Canvas
 * Canvas HTML5 interattivo per disegnare e visualizzare poligoni ROI.
 *
 * Risolve i 3 problemi strutturali:
 * 1. Coordinate corrette: getBoundingClientRect + rapporto canvas/display
 * 2. Sfondo camera: carica snapshot JPEG come immagine di sfondo
 * 3. Responsive: dimensione logica fissa 1280x720, CSS fluid con aspect-ratio
 */
import { useRef, useEffect, useState, useCallback } from 'react';
import { getCameraSnapshotUrl } from '../../services/api';

// Dimensioni logiche del canvas (corrispondono alla risoluzione del frame)
const CANVAS_W = 1280;
const CANVAS_H = 720;

// Colori per le ROI (ciclici)
const ROI_COLORS = [
  'rgba(0, 255, 100, 0.6)',   // Verde
  'rgba(100, 200, 255, 0.6)', // Azzurro
  'rgba(255, 255, 0, 0.6)',   // Giallo
  'rgba(255, 100, 100, 0.6)', // Rosso
  'rgba(200, 100, 255, 0.6)', // Viola
  'rgba(255, 180, 50, 0.6)',  // Arancione
];

const ROI_FILL_COLORS = [
  'rgba(0, 255, 100, 0.08)',
  'rgba(100, 200, 255, 0.08)',
  'rgba(255, 255, 0, 0.08)',
  'rgba(255, 100, 100, 0.08)',
  'rgba(200, 100, 255, 0.08)',
  'rgba(255, 180, 50, 0.08)',
];

/**
 * @param {Object} props
 * @param {string} props.cameraId - ID della camera per caricare lo snapshot
 * @param {Array} props.rois - Array di ROI da visualizzare [{id, name, points, is_active}]
 * @param {number|null} props.selectedRoiId - ID della ROI evidenziata
 * @param {Function} props.onRoiCreated - Callback con array di punti [[x,y], ...]
 * @param {Function} props.onRoiSelected - Callback con roi id
 * @param {boolean} props.isDrawing - Modalità disegno attiva
 * @param {Function} props.onDrawingCancel - Callback per annullare il disegno
 */
export default function ROICanvas({
  cameraId,
  rois = [],
  selectedRoiId = null,
  onRoiCreated,
  onRoiSelected,
  isDrawing = false,
  onDrawingCancel,
}) {
  const canvasRef = useRef(null);
  const [bgImage, setBgImage] = useState(null);
  const [currentPoints, setCurrentPoints] = useState([]);
  const [mousePos, setMousePos] = useState(null);
  const [snapshotError, setSnapshotError] = useState(false);

  // -----------------------------------------------------------------
  // Carica snapshot camera come immagine di sfondo
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!cameraId) {
      setBgImage(null);
      return;
    }

    setSnapshotError(false);
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      setBgImage(img);
      setSnapshotError(false);
    };

    img.onerror = () => {
      setBgImage(null);
      setSnapshotError(true);
    };

    // Aggiungi timestamp per evitare cache
    img.src = `${getCameraSnapshotUrl(cameraId)}?t=${Date.now()}`;
  }, [cameraId]);

  // -----------------------------------------------------------------
  // Converti coordinate mouse → coordinate canvas logiche
  // -----------------------------------------------------------------
  const toCanvasCoords = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;

    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  }, []);

  // -----------------------------------------------------------------
  // Verifica se click è vicino al primo punto (per chiudere poligono)
  // -----------------------------------------------------------------
  const isNearFirstPoint = useCallback(
    (pt) => {
      if (currentPoints.length < 3) return false;
      const first = currentPoints[0];
      const dx = pt.x - first[0];
      const dy = pt.y - first[1];
      return Math.sqrt(dx * dx + dy * dy) < 20; // 20px di tolleranza
    },
    [currentPoints]
  );

  // -----------------------------------------------------------------
  // Gestione click sul canvas
  // -----------------------------------------------------------------
  const handleClick = useCallback(
    (e) => {
      if (!isDrawing) {
        // In modalità selezione: verifica se si è cliccato dentro una ROI
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

      // Se vicino al primo punto → chiudi poligono
      if (isNearFirstPoint(pt)) {
        const finalPoints = [...currentPoints];
        setCurrentPoints([]);
        onRoiCreated?.(finalPoints);
        return;
      }

      setCurrentPoints((prev) => [...prev, [pt.x, pt.y]]);
    },
    [isDrawing, toCanvasCoords, currentPoints, isNearFirstPoint, onRoiCreated, onRoiSelected, rois]
  );

  // Doppio click → chiudi poligono
  const handleDoubleClick = useCallback(
    (e) => {
      if (!isDrawing || currentPoints.length < 3) return;
      e.preventDefault();

      const finalPoints = [...currentPoints];
      setCurrentPoints([]);
      onRoiCreated?.(finalPoints);
    },
    [isDrawing, currentPoints, onRoiCreated]
  );

  // Movimento mouse → aggiorna preview
  const handleMouseMove = useCallback(
    (e) => {
      if (!isDrawing) {
        setMousePos(null);
        return;
      }
      const pt = toCanvasCoords(e);
      setMousePos(pt);
    },
    [isDrawing, toCanvasCoords]
  );

  // Tasto Esc → annulla disegno
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

  // Reset punti quando si disattiva la modalità disegno
  useEffect(() => {
    if (!isDrawing) {
      setCurrentPoints([]);
    }
  }, [isDrawing]);

  // -----------------------------------------------------------------
  // Rendering canvas
  // -----------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Pulisci
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Sfondo: snapshot camera o grigio scuro
    if (bgImage) {
      ctx.drawImage(bgImage, 0, 0, CANVAS_W, CANVAS_H);
    } else {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Griglia di riferimento
      ctx.strokeStyle = 'rgba(100, 100, 140, 0.15)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= CANVAS_W; x += 80) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_H);
        ctx.stroke();
      }
      for (let y = 0; y <= CANVAS_H; y += 80) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_W, y);
        ctx.stroke();
      }

      // Messaggio centrale
      ctx.fillStyle = snapshotError ? '#ef4444' : '#64748b';
      ctx.font = '18px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(
        snapshotError
          ? 'Snapshot non disponibile — camera offline'
          : cameraId
            ? 'Caricamento snapshot...'
            : 'Seleziona una camera per iniziare',
        CANVAS_W / 2,
        CANVAS_H / 2
      );
      ctx.textAlign = 'start';
    }

    // Disegna ROI esistenti
    rois.forEach((roi, i) => {
      const colorIdx = i % ROI_COLORS.length;
      const isSelected = roi.id === selectedRoiId;
      const isActive = roi.is_active !== false;

      drawPolygon(ctx, roi.points, {
        strokeColor: isActive ? ROI_COLORS[colorIdx] : 'rgba(100, 100, 100, 0.4)',
        fillColor: isSelected
          ? 'rgba(59, 130, 246, 0.15)'
          : isActive
            ? ROI_FILL_COLORS[colorIdx]
            : 'rgba(50, 50, 50, 0.05)',
        lineWidth: isSelected ? 3 : 2,
        dashed: !isActive,
      });

      // Nome ROI
      if (roi.points.length > 0) {
        const labelPt = getPolygonCenter(roi.points);
        ctx.fillStyle = isActive ? '#e2e8f0' : '#64748b';
        ctx.font = isSelected ? 'bold 14px system-ui' : '13px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(roi.name, labelPt[0], labelPt[1]);
        ctx.textAlign = 'start';
      }
    });

    // Disegna poligono in corso di creazione
    if (isDrawing && currentPoints.length > 0) {
      // Linee tra i punti
      ctx.beginPath();
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.moveTo(currentPoints[0][0], currentPoints[0][1]);
      for (let i = 1; i < currentPoints.length; i++) {
        ctx.lineTo(currentPoints[i][0], currentPoints[i][1]);
      }

      // Preview: linea tratteggiata al mouse
      if (mousePos) {
        ctx.setLineDash([8, 4]);
        ctx.lineTo(mousePos.x, mousePos.y);
        ctx.setLineDash([]);
      }
      ctx.stroke();

      // Vertici
      currentPoints.forEach((pt, i) => {
        ctx.beginPath();
        ctx.fillStyle = i === 0 ? '#22c55e' : '#3b82f6';
        ctx.arc(pt[0], pt[1], i === 0 ? 8 : 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // Highlight primo punto quando vicino
      if (mousePos && isNearFirstPoint(mousePos)) {
        ctx.beginPath();
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.arc(currentPoints[0][0], currentPoints[0][1], 15, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Istruzioni in modalità disegno
    if (isDrawing) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(0, CANVAS_H - 36, CANVAS_W, 36);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '13px system-ui';
      ctx.fillText(
        currentPoints.length === 0
          ? '  Click per aggiungere vertici • Doppio-click o click sul primo punto per chiudere • Esc per annullare'
          : `  ${currentPoints.length} vertici • Click per aggiungere • ${currentPoints.length >= 3 ? 'Doppio-click o click sul primo punto (verde) per chiudere' : 'Servono almeno 3 vertici'} • Esc annulla`,
        10,
        CANVAS_H - 12
      );
    }

    // Info coordinate in alto a destra
    if (isDrawing && mousePos) {
      const coordText = `${mousePos.x}, ${mousePos.y}`;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      const tw = ctx.measureText(coordText).width;
      ctx.fillRect(CANVAS_W - tw - 20, 0, tw + 20, 28);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px monospace';
      ctx.fillText(coordText, CANVAS_W - tw - 10, 18);
    }
  }, [bgImage, rois, selectedRoiId, isDrawing, currentPoints, mousePos, snapshotError, cameraId, isNearFirstPoint]);

  return (
    <div className="relative w-full">
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseMove={handleMouseMove}
        className="w-full rounded-lg border border-slate-700 bg-slate-900"
        style={{
          aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
          cursor: isDrawing ? 'crosshair' : 'default',
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Funzioni helper
// ---------------------------------------------------------------------------

/**
 * Disegna un poligono sul canvas.
 */
function drawPolygon(ctx, points, { strokeColor, fillColor, lineWidth = 2, dashed = false } = {}) {
  if (!points || points.length < 3) return;

  ctx.beginPath();
  ctx.setLineDash(dashed ? [6, 4] : []);
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.closePath();

  if (fillColor) {
    ctx.fillStyle = fillColor;
    ctx.fill();
  }

  ctx.strokeStyle = strokeColor || '#fff';
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Calcola il centroide di un poligono.
 */
function getPolygonCenter(points) {
  if (!points || points.length === 0) return [0, 0];
  const sumX = points.reduce((s, p) => s + p[0], 0);
  const sumY = points.reduce((s, p) => s + p[1], 0);
  return [sumX / points.length, sumY / points.length];
}

/**
 * Verifica se un punto è dentro un poligono (ray casting algorithm).
 */
function isPointInPolygon(pt, polygon) {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];

    if (
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }

  return inside;
}
