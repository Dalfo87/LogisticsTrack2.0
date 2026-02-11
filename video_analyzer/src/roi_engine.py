"""
LogisticsTrack — ROI Engine
Motore geometrico per Region of Interest poligonali.

Funzionalità:
- Poligoni liberi (non limitati a rettangoli) via Shapely
- Gerarchia padre/figlio (parent_id)
- Punto di intersezione configurabile per ogni ROI (bottom_center, centroid, top_center)
- Stato tracker per ROI: traccia quando un track_id entra, esce, e il dwell time
- Caricamento ROI da file JSON

Coordinate:
- Le ROI sono definite in coordinate PIXEL nel piano immagine della camera.
- Il file rois.json usa coordinate pixel assolute riferite alla risoluzione del frame.
"""

import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from shapely.geometry import Point, Polygon

from detector import Detection
from reference_point import ReferencePoint, compute_reference_point

logger = logging.getLogger("ROIEngine")


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class ROIDefinition:
    """Definizione di una singola ROI."""
    id: str                                     # Identificativo univoco (es. "ROI_A01")
    name: str                                   # Nome leggibile (es. "Corsia A-01")
    aisle_id: str                               # Identificativo corsia/scaffale
    camera_id: str                              # Camera associata
    points: list[tuple[float, float]]           # Vertici poligono [(x,y), ...] in pixel
    reference_point: ReferencePoint = ReferencePoint.BOTTOM_CENTER
    parent_id: Optional[str] = None             # ROI padre (gerarchia)
    is_active: bool = True                      # Abilitata/disabilitata
    color: tuple[int, int, int] = (0, 255, 0)  # Colore overlay BGR

    def __post_init__(self) -> None:
        """Crea il poligono Shapely dai punti."""
        if len(self.points) < 3:
            raise ValueError(f"ROI '{self.id}': servono almeno 3 punti, trovati {len(self.points)}")
        self._polygon = Polygon(self.points)
        if not self._polygon.is_valid:
            logger.warning(f"ROI '{self.id}': poligono non valido, applico buffer(0) per correggere")
            self._polygon = self._polygon.buffer(0)

    @property
    def polygon(self) -> Polygon:
        return self._polygon


@dataclass
class TrackState:
    """Stato di un singolo tracker rispetto a una ROI."""
    track_id: int
    roi_id: str
    is_inside: bool = False
    entered_at: Optional[float] = None    # timestamp monotonic di ingresso
    last_seen_at: Optional[float] = None  # ultimo frame in cui è stato visto nella ROI
    confidence: float = 0.0               # ultima confidence rilevata
    bbox: tuple[int, int, int, int] = (0, 0, 0, 0)

    @property
    def dwell_seconds(self) -> float:
        """Tempo di permanenza nella ROI in secondi."""
        if self.entered_at is None:
            return 0.0
        ref_time = self.last_seen_at if self.last_seen_at else time.monotonic()
        return ref_time - self.entered_at


@dataclass
class ROIEvent:
    """Evento generato dal ROI engine."""
    event_type: str         # "roi_enter", "roi_exit", "dwell_time"
    roi_id: str
    roi_name: str
    aisle_id: str
    camera_id: str
    track_id: int
    confidence: float
    bbox: tuple[int, int, int, int]
    reference_point_used: str          # "bottom_center", "centroid", "top_center"
    timestamp: float                   # time.time() (epoch)
    dwell_seconds: float = 0.0        # solo per roi_exit e dwell_time
    parent_roi_id: Optional[str] = None


# ---------------------------------------------------------------------------
# ROI Engine
# ---------------------------------------------------------------------------

class ROIEngine:
    """
    Motore ROI: verifica intersezione oggetti con zone poligonali,
    gestisce stato enter/exit/dwell per ogni track_id.
    """

    def __init__(self) -> None:
        self._rois: dict[str, ROIDefinition] = {}           # roi_id → ROIDefinition
        self._track_states: dict[str, TrackState] = {}      # "track_id:roi_id" → TrackState
        self._dwell_thresholds: dict[str, float] = {}       # roi_id → soglia dwell in secondi

    # -------------------------------------------------------------------
    # Caricamento ROI
    # -------------------------------------------------------------------

    def load_from_file(self, filepath: str | Path) -> int:
        """
        Carica ROI da file JSON.

        Formato atteso:
        {
            "rois": [
                {
                    "id": "ROI_A01",
                    "name": "Corsia A-01",
                    "aisle_id": "A-01",
                    "camera_id": "CAM_DEV_01",
                    "points": [[100, 200], [400, 200], [400, 600], [100, 600]],
                    "reference_point": "bottom_center",
                    "parent_id": null,
                    "color": [0, 255, 0],
                    "dwell_threshold_sec": 5.0
                }
            ]
        }

        Returns:
            Numero di ROI caricate.
        """
        filepath = Path(filepath)
        if not filepath.exists():
            logger.warning(f"File ROI non trovato: {filepath}. Nessuna ROI caricata.")
            return 0

        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)

        rois_data = data.get("rois", [])
        loaded = 0

        for roi_data in rois_data:
            try:
                # Parse reference point
                ref_str = roi_data.get("reference_point", "bottom_center")
                try:
                    ref_point = ReferencePoint(ref_str)
                except ValueError:
                    logger.warning(f"Reference point '{ref_str}' non valido per ROI '{roi_data['id']}', uso bottom_center")
                    ref_point = ReferencePoint.BOTTOM_CENTER

                # Parse colore
                color_list = roi_data.get("color", [0, 255, 0])
                color = tuple(color_list) if len(color_list) == 3 else (0, 255, 0)

                # Parse punti come lista di tuple
                points = [tuple(p) for p in roi_data["points"]]

                roi = ROIDefinition(
                    id=roi_data["id"],
                    name=roi_data["name"],
                    aisle_id=roi_data["aisle_id"],
                    camera_id=roi_data["camera_id"],
                    points=points,
                    reference_point=ref_point,
                    parent_id=roi_data.get("parent_id"),
                    is_active=roi_data.get("is_active", True),
                    color=color,
                )

                self._rois[roi.id] = roi

                # Soglia dwell opzionale
                dwell_sec = roi_data.get("dwell_threshold_sec", 0.0)
                if dwell_sec > 0:
                    self._dwell_thresholds[roi.id] = dwell_sec

                loaded += 1
                logger.info(
                    f"ROI caricata: '{roi.name}' ({roi.id}) — "
                    f"{len(roi.points)} vertici, ref={ref_point.value}, "
                    f"parent={roi.parent_id or 'nessuno'}"
                )

            except (KeyError, ValueError) as e:
                logger.error(f"Errore nel caricamento ROI: {e}")

        logger.info(f"Totale ROI caricate: {loaded}/{len(rois_data)}")
        return loaded

    def add_roi(self, roi: ROIDefinition, dwell_threshold_sec: float = 0.0) -> None:
        """Aggiunge una ROI programmaticamente."""
        self._rois[roi.id] = roi
        if dwell_threshold_sec > 0:
            self._dwell_thresholds[roi.id] = dwell_threshold_sec

    @property
    def roi_count(self) -> int:
        return len(self._rois)

    @property
    def active_rois(self) -> list[ROIDefinition]:
        return [r for r in self._rois.values() if r.is_active]

    def get_children(self, parent_id: str) -> list[ROIDefinition]:
        """Ritorna le ROI figlie di un parent."""
        return [r for r in self._rois.values() if r.parent_id == parent_id]

    # -------------------------------------------------------------------
    # Logica di intersezione
    # -------------------------------------------------------------------

    def _state_key(self, track_id: int, roi_id: str) -> str:
        return f"{track_id}:{roi_id}"

    def _get_state(self, track_id: int, roi_id: str) -> TrackState:
        """Ritorna o crea lo stato per un track_id in una ROI."""
        key = self._state_key(track_id, roi_id)
        if key not in self._track_states:
            self._track_states[key] = TrackState(track_id=track_id, roi_id=roi_id)
        return self._track_states[key]

    def process_detections(self, detections: list[Detection]) -> list[ROIEvent]:
        """
        Processa le detection di un frame e genera eventi ROI.

        Per ogni detection con track_id valido, verifica se il punto di riferimento
        cade dentro ciascuna ROI attiva. Genera eventi:
        - roi_enter: quando un tracker entra in una ROI
        - roi_exit: quando un tracker esce da una ROI (include dwell_seconds)
        - dwell_time: quando un tracker supera la soglia di permanenza

        Args:
            detections: Lista di Detection dal Detector.

        Returns:
            Lista di ROIEvent generati in questo frame.
        """
        events: list[ROIEvent] = []
        now = time.monotonic()
        now_epoch = time.time()

        # Set dei track_id visti in questo frame (per gestire uscite)
        seen_track_ids: set[int] = set()

        for det in detections:
            # Ignora detection senza tracking
            if det.track_id < 0:
                continue

            seen_track_ids.add(det.track_id)

            for roi in self.active_rois:
                # Calcola il punto di riferimento secondo la strategia della ROI
                ref_point = compute_reference_point(det.bbox, roi.reference_point)
                point = Point(ref_point)

                is_inside = roi.polygon.contains(point)
                state = self._get_state(det.track_id, roi.id)

                if is_inside and not state.is_inside:
                    # === INGRESSO nella ROI ===
                    state.is_inside = True
                    state.entered_at = now
                    state.last_seen_at = now
                    state.confidence = det.confidence
                    state.bbox = det.bbox

                    event = ROIEvent(
                        event_type="roi_enter",
                        roi_id=roi.id,
                        roi_name=roi.name,
                        aisle_id=roi.aisle_id,
                        camera_id=roi.camera_id,
                        track_id=det.track_id,
                        confidence=det.confidence,
                        bbox=det.bbox,
                        reference_point_used=roi.reference_point.value,
                        timestamp=now_epoch,
                        parent_roi_id=roi.parent_id,
                    )
                    events.append(event)
                    logger.info(
                        f"ENTER: track_id={det.track_id} → ROI '{roi.name}' "
                        f"(aisle={roi.aisle_id})"
                    )

                elif is_inside and state.is_inside:
                    # === PERMANENZA nella ROI ===
                    state.last_seen_at = now
                    state.confidence = det.confidence
                    state.bbox = det.bbox

                    # Check soglia dwell
                    if roi.id in self._dwell_thresholds:
                        threshold = self._dwell_thresholds[roi.id]
                        dwell = state.dwell_seconds
                        # Genera evento dwell solo quando supera la soglia
                        # (con tolleranza di 1 frame per non generare duplicati)
                        if dwell >= threshold and (dwell - threshold) < 0.2:
                            event = ROIEvent(
                                event_type="dwell_time",
                                roi_id=roi.id,
                                roi_name=roi.name,
                                aisle_id=roi.aisle_id,
                                camera_id=roi.camera_id,
                                track_id=det.track_id,
                                confidence=det.confidence,
                                bbox=det.bbox,
                                reference_point_used=roi.reference_point.value,
                                timestamp=now_epoch,
                                dwell_seconds=dwell,
                                parent_roi_id=roi.parent_id,
                            )
                            events.append(event)
                            logger.info(
                                f"DWELL: track_id={det.track_id} in ROI '{roi.name}' "
                                f"per {dwell:.1f}s (soglia: {threshold}s)"
                            )

                elif not is_inside and state.is_inside:
                    # === USCITA dalla ROI ===
                    dwell = state.dwell_seconds
                    state.is_inside = False

                    event = ROIEvent(
                        event_type="roi_exit",
                        roi_id=roi.id,
                        roi_name=roi.name,
                        aisle_id=roi.aisle_id,
                        camera_id=roi.camera_id,
                        track_id=det.track_id,
                        confidence=det.confidence,
                        bbox=det.bbox,
                        reference_point_used=roi.reference_point.value,
                        timestamp=now_epoch,
                        dwell_seconds=dwell,
                        parent_roi_id=roi.parent_id,
                    )
                    events.append(event)
                    logger.info(
                        f"EXIT: track_id={det.track_id} ← ROI '{roi.name}' "
                        f"(dwell={dwell:.1f}s)"
                    )

                    # Reset stato
                    state.entered_at = None
                    state.last_seen_at = None

        # Gestione track_id che non compaiono più (persi dal tracker)
        # Genera uscite per tutti i track che erano dentro una ROI
        # ma non sono più visibili in questo frame
        lost_events = self._handle_lost_tracks(seen_track_ids, now_epoch)
        events.extend(lost_events)

        return events

    def _handle_lost_tracks(
        self,
        seen_track_ids: set[int],
        now_epoch: float,
    ) -> list[ROIEvent]:
        """
        Genera eventi di uscita per tracker che non sono più visibili
        ma risultavano dentro una ROI.

        Usa una tolleranza: il tracker deve essere assente per almeno 1 secondo
        prima di considerarlo "perso". Questo evita falsi exit per frame drop.
        """
        events: list[ROIEvent] = []
        now = time.monotonic()
        lost_tolerance_sec = 1.0  # Tolleranza prima di dichiarare uscita

        keys_to_cleanup = []

        for key, state in self._track_states.items():
            if not state.is_inside:
                continue

            if state.track_id in seen_track_ids:
                continue

            # Track non visto — verifica tolleranza
            if state.last_seen_at and (now - state.last_seen_at) < lost_tolerance_sec:
                continue

            # Track perso → genera exit
            roi = self._rois.get(state.roi_id)
            if roi is None:
                keys_to_cleanup.append(key)
                continue

            dwell = state.dwell_seconds

            event = ROIEvent(
                event_type="roi_exit",
                roi_id=roi.id,
                roi_name=roi.name,
                aisle_id=roi.aisle_id,
                camera_id=roi.camera_id,
                track_id=state.track_id,
                confidence=state.confidence,
                bbox=state.bbox,
                reference_point_used=roi.reference_point.value,
                timestamp=now_epoch,
                dwell_seconds=dwell,
                parent_roi_id=roi.parent_id,
            )
            events.append(event)
            logger.info(
                f"EXIT (track lost): track_id={state.track_id} ← ROI '{roi.name}' "
                f"(dwell={dwell:.1f}s)"
            )

            state.is_inside = False
            state.entered_at = None
            state.last_seen_at = None
            keys_to_cleanup.append(key)

        # Pulizia stati orfani
        for key in keys_to_cleanup:
            del self._track_states[key]

        return events

    # -------------------------------------------------------------------
    # Visualizzazione overlay
    # -------------------------------------------------------------------

    def draw_rois(self, frame, detections: list[Detection] | None = None) -> None:
        """
        Disegna le ROI sul frame come overlay semi-trasparente.

        Args:
            frame: Frame BGR (modificato in-place).
            detections: Se fornite, evidenzia le ROI che contengono almeno un tracker.
        """
        import cv2
        import numpy as np

        overlay = frame.copy()

        for roi in self.active_rois:
            pts = np.array(roi.points, dtype=np.int32)
            color = roi.color

            # Verifica se qualche tracker è dentro questa ROI
            has_tracker_inside = False
            if detections:
                for det in detections:
                    if det.track_id < 0:
                        continue
                    state = self._track_states.get(self._state_key(det.track_id, roi.id))
                    if state and state.is_inside:
                        has_tracker_inside = True
                        break

            # Riempimento semi-trasparente
            fill_color = (0, 0, 255) if has_tracker_inside else color
            alpha = 0.25 if has_tracker_inside else 0.12
            cv2.fillPoly(overlay, [pts], fill_color)

            # Bordo
            border_color = (0, 0, 255) if has_tracker_inside else color
            border_thickness = 3 if has_tracker_inside else 2
            cv2.polylines(frame, [pts], isClosed=True, color=border_color, thickness=border_thickness)

            # Label ROI
            # Posiziona in alto-sinistra del bounding rect del poligono
            bx, by, bw, bh = cv2.boundingRect(pts)
            label = f"{roi.name}"
            if has_tracker_inside:
                # Mostra dwell time del primo tracker dentro
                for det in (detections or []):
                    if det.track_id < 0:
                        continue
                    state = self._track_states.get(self._state_key(det.track_id, roi.id))
                    if state and state.is_inside:
                        label += f" [{state.dwell_seconds:.1f}s]"
                        break

            label_size, _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
            lw, lh = label_size
            cv2.rectangle(frame, (bx, by - lh - 8), (bx + lw + 6, by), border_color, -1)
            cv2.putText(frame, label, (bx + 3, by - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2)

        # Blend overlay
        import cv2 as _cv2
        _cv2.addWeighted(overlay, 0.3, frame, 0.7, 0, frame)

    # -------------------------------------------------------------------
    # Cleanup
    # -------------------------------------------------------------------

    def reset(self) -> None:
        """Reset completo degli stati di tracking (non delle ROI)."""
        self._track_states.clear()
        logger.info("Stati tracking ROI resettati.")

    def clear_all(self) -> None:
        """Rimuove tutte le ROI e gli stati."""
        self._rois.clear()
        self._track_states.clear()
        self._dwell_thresholds.clear()
        logger.info("Tutte le ROI e gli stati rimossi.")
