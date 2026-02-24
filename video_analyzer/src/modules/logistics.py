"""
LogisticsTrack — Modulo Logistics

Traccia muletti/pallet nelle ROI di magazzino (corsie, scaffali).
Wrappa il ROIEngine esistente nell'interfaccia BaseVideoModule.

Responsabilità:
- Carica le ROI da file JSON (via ROIEngine)
- Processa le detection YOLO per rilevare enter/exit/dwell nelle ROI
- Converte i ROIEvent in BaseEvent con event_data strutturato
- Supporta hot-reload ROI via on_reload_signal()
- Disegna overlay ROI sul frame (poligoni + stato tracker)
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np

from detector import Detection
from modules.base import BaseEvent, BaseVideoModule, FrameMeta
from roi_engine import ROIEngine, ROIEvent

logger = logging.getLogger("LogisticsModule")


class LogisticsModule(BaseVideoModule):
    """
    Modulo di analisi logistics: tracciamento muletti in ROI di magazzino.

    Configurazione (campo "config" in modules.json):
        roi_file (str): Path al file JSON delle ROI.
                        Default: "data/rois.json"

    Event types generati:
        - "roi_enter": un muletto è entrato in una ROI
        - "roi_exit": un muletto è uscito da una ROI
        - "dwell_time": un muletto è rimasto in una ROI oltre la soglia

    event_data per ogni evento:
        roi_id, roi_name, aisle_id, dwell_seconds,
        reference_point, parent_roi_id, label
    """

    @property
    def module_type(self) -> str:
        return "logistics"

    def __init__(self) -> None:
        self._roi_engine: ROIEngine | None = None
        self._roi_file: str = "data/rois.json"
        self._last_detections: list[Detection] = []

    def initialize(self, config: dict[str, Any]) -> None:
        """
        Carica le ROI dal file JSON e inizializza il ROIEngine.

        Args:
            config: {"roi_file": "data/rois.json"}
        """
        self._roi_file = config.get("roi_file", "data/rois.json")
        self._roi_engine = ROIEngine()
        roi_count = self._roi_engine.load_from_file(self._roi_file)
        if roi_count == 0:
            logger.warning(
                f"LogisticsModule: nessuna ROI caricata da {self._roi_file}. "
                "Il modulo processerà le detection ma non genererà eventi."
            )
        else:
            logger.info(f"LogisticsModule: {roi_count} ROI caricate da {self._roi_file}")

    def process_frame(
        self,
        frame: np.ndarray,
        detections: list[Detection],
        meta: FrameMeta,
    ) -> list[BaseEvent]:
        """
        Processa le detection YOLO e genera eventi ROI.

        Usa il ROIEngine per:
        1. Determinare quali detection sono dentro/fuori dalle ROI
        2. Gestire le transizioni di stato (enter/exit/dwell)
        3. Generare i ROIEvent corrispondenti

        Args:
            frame: Frame BGR originale (non modificato).
            detections: Detection YOLO con tracking ID persistente.
            meta: Metadata del frame (timestamp, camera_id, ecc.).

        Returns:
            Lista di BaseEvent (roi_enter, roi_exit, dwell_time).
        """
        if self._roi_engine is None:
            return []

        # Cache per draw_overlay
        self._last_detections = detections

        # Processo detection con il ROIEngine esistente
        roi_events: list[ROIEvent] = self._roi_engine.process_detections(detections)

        # Converti ROIEvent → BaseEvent con schema v2.0
        return [self._convert_event(e, meta) for e in roi_events]

    def _convert_event(self, e: ROIEvent, meta: FrameMeta) -> BaseEvent:
        """Converte un ROIEvent nel formato BaseEvent (schema v2.0)."""
        return BaseEvent(
            event_type=str(e.event_type),
            camera_id=meta.camera_id,
            timestamp=e.timestamp,
            module_type=self.module_type,
            track_id=int(e.track_id),
            confidence=float(e.confidence),
            bbox=tuple(int(x) for x in e.bbox),  # type: ignore[arg-type]
            event_data={
                "roi_id": str(e.roi_id),
                "roi_name": str(e.roi_name),
                "aisle_id": str(e.aisle_id),
                "dwell_seconds": float(round(e.dwell_seconds, 2)),
                "reference_point": str(e.reference_point_used),
                "parent_roi_id": str(e.parent_roi_id) if e.parent_roi_id else None,
                "label": str(e.label) if e.label else "",
            },
            crop_filename=str(e.crop_filename) if e.crop_filename else "",
        )

    def draw_overlay(
        self,
        frame: np.ndarray,
        events: list[BaseEvent],
    ) -> np.ndarray:
        """
        Disegna i poligoni ROI e lo stato dei tracker sul frame.

        Usa il ROIEngine.draw_rois() con le ultime detection cachate.
        """
        if self._roi_engine is None:
            return frame
        self._roi_engine.draw_rois(frame, self._last_detections)  # modifica in-place
        return frame

    def reset(self) -> None:
        """Azzera lo stato interno del ROIEngine (track states + timing)."""
        if self._roi_engine is not None:
            self._roi_engine.reset()
            logger.info("LogisticsModule: stati ROI resettati.")

    def on_reload_signal(self) -> None:
        """
        Ricarica le ROI da file su segnale hot-reload dal backend.

        Chiamato quando il backend pubblica su MQTT 'logistics/control/reload_rois'
        (es. dopo che l'utente ha esportato le ROI dal ROI Editor).
        """
        if self._roi_engine is None:
            return
        self._roi_engine.clear_all()
        roi_count = self._roi_engine.load_from_file(self._roi_file)
        logger.info(f"LogisticsModule: hot-reload completato — {roi_count} ROI ricaricate")
