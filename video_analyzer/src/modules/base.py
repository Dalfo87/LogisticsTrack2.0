"""
LogisticsTrack — Interfacce Base per Moduli di Analisi Video

Definisce le dataclass e le ABC che tutti i moduli devono implementare.

Struttura:
- FrameMeta: metadata del frame corrente (timestamp, camera, dimensioni)
- BaseEvent: evento base generato da qualsiasi modulo
- BaseVideoModule: interfaccia ABC per tutti i moduli di analisi
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import numpy as np

if TYPE_CHECKING:
    from detector import Detection

logger = logging.getLogger("BaseVideoModule")


@dataclass
class FrameMeta:
    """Metadata associati al frame corrente nella pipeline."""

    timestamp: float    # Epoch UTC (time.time())
    frame_idx: int      # Indice progressivo del frame (parte da 0 ad ogni restart)
    camera_id: str      # Identificatore camera (es: "CAM_DEV_01")
    width: int          # Larghezza frame in pixel
    height: int         # Altezza frame in pixel


@dataclass
class BaseEvent:
    """
    Evento base generato da qualsiasi modulo di analisi video.

    I dati specifici del modulo vengono inseriti in `event_data` (dict JSONB-compatibile).
    Il backend persiste questo oggetto con uno schema v2.0 che include `module_type`.
    """

    event_type: str                         # Es: "roi_enter", "person_no_vest"
    camera_id: str                          # Identificatore camera sorgente
    timestamp: float                        # Epoch UTC dell'evento
    module_type: str                        # Es: "logistics", "no_entry_filter"
    track_id: int                           # ID tracker (-1 se non applicabile)
    confidence: float                       # Confidenza 0.0–1.0
    bbox: tuple[int, int, int, int]         # Bounding box (x1, y1, x2, y2)
    event_data: dict[str, Any] = field(default_factory=dict)  # Dati specifici modulo
    crop_filename: str = ""                 # Path relativo del crop (camera_id/filename.jpg)


class BaseVideoModule(ABC):
    """
    Interfaccia base per tutti i moduli di analisi video.

    Ogni modulo deve implementare:
    - module_type: identificatore univoco del modulo
    - initialize(config): caricamento modelli, ROI, parametri
    - process_frame(frame, detections, meta): core logic, genera eventi
    - draw_overlay(frame, events): disegna overlay specifico del modulo
    - reset(): azzera stato interno (utile per debug o cambio sorgente)

    Opzionalmente può fare override di:
    - on_reload_signal(): gestisce segnali di hot-reload (ROI, config, ecc.)
    """

    @property
    @abstractmethod
    def module_type(self) -> str:
        """
        Identificatore univoco del modulo.
        Deve essere snake_case e corrispondere a module_type nel DB.
        Es: "logistics", "no_entry_filter"
        """
        ...

    @abstractmethod
    def initialize(self, config: dict[str, Any]) -> None:
        """
        Inizializza il modulo con la configurazione specifica.

        Viene chiamato UNA VOLTA prima del loop principale.
        Usare per: caricare modelli, leggere ROI, settare parametri.

        Args:
            config: Dict di configurazione specifico del modulo
                    (corrisponde al campo "config" in modules.json).
        """
        ...

    @abstractmethod
    def process_frame(
        self,
        frame: np.ndarray,
        detections: list[Detection],
        meta: FrameMeta,
    ) -> list[BaseEvent]:
        """
        Processa un frame e restituisce gli eventi generati.

        Viene chiamato ad ogni frame della pipeline principale.
        Deve essere il più veloce possibile (non fare I/O bloccante qui).

        Args:
            frame: Frame BGR originale (numpy array HxWx3).
            detections: Lista di Detection dal YOLO detector principale.
                        (Il modulo può ignorarle e usare il proprio modello).
            meta: Metadata del frame (timestamp, camera_id, ecc.).

        Returns:
            Lista di BaseEvent (può essere vuota se nessun evento rilevato).
        """
        ...

    @abstractmethod
    def draw_overlay(
        self,
        frame: np.ndarray,
        events: list[BaseEvent],
    ) -> np.ndarray:
        """
        Disegna overlay specifico del modulo sul frame.

        Viene chiamato dopo process_frame() per aggiungere visualizzazioni
        (poligoni ROI, keypoints, bounding box custom, testi, ecc.).

        Args:
            frame: Frame già annotato dai moduli precedenti (in-place modificabile).
            events: Lista di eventi generati da process_frame() in questo frame.

        Returns:
            Frame con overlay aggiunto.
        """
        ...

    @abstractmethod
    def reset(self) -> None:
        """
        Azzera lo stato interno del modulo.

        Utile per: debug manuale (tasto 'r'), cambio sorgente video,
        cambio modello YOLO, reset dopo errore.
        """
        ...

    def on_reload_signal(self) -> None:
        """
        Gestisce segnali di hot-reload (es. ROI aggiornate dal backend).

        Default: no-op. I moduli che usano ROI devono fare override.
        Viene chiamato quando il backend invia il segnale MQTT di reload.
        """
        pass
