"""
LogisticsTrack — Object Detector & Tracker
Usa Ultralytics YOLOv8 per detection e tracking di muletti e pallet.
"""

import logging
from dataclasses import dataclass

import cv2
import numpy as np
from ultralytics import YOLO

from config import VideoAnalyzerConfig

logger = logging.getLogger("Detector")


@dataclass
class Detection:
    """Singola detection rilevata nel frame."""
    track_id: int          # ID tracking persistente (-1 se non tracciato)
    class_id: int          # Indice classe COCO/custom
    class_name: str        # Nome classe leggibile
    confidence: float      # Confidenza 0.0 - 1.0
    bbox: tuple[int, int, int, int]  # (x1, y1, x2, y2) in pixel
    center: tuple[int, int]          # Centro bounding box
    bottom_center: tuple[int, int]   # Punto basso-centro (per ROI a prospettiva)


class Detector:
    """
    Motore di detection e tracking basato su YOLOv8.

    Utilizza il tracking integrato di Ultralytics (ByteTrack o BoTSORT)
    per assegnare ID persistenti agli oggetti tra frame consecutivi.
    """

    # Colori per visualizzazione (per track_id % len)
    COLORS = [
        (255, 100, 100), (100, 255, 100), (100, 100, 255),
        (255, 255, 100), (255, 100, 255), (100, 255, 255),
        (200, 150, 50),  (50, 200, 150),  (150, 50, 200),
        (255, 200, 100), (100, 200, 255), (200, 100, 255),
    ]

    def __init__(self, config: VideoAnalyzerConfig) -> None:
        self.config = config
        self.model: YOLO | None = None
        self._load_model()

    def _load_model(self) -> None:
        """Carica il modello YOLO. Scarica automaticamente se non presente."""
        model_path = self.config.yolo_model
        logger.info(f"Caricamento modello YOLO: {model_path}")
        logger.info(f"Device: {self.config.yolo_device}")

        self.model = YOLO(model_path)

        # Verifica classi disponibili
        class_names = self.model.names
        logger.info(f"Classi disponibili nel modello: {len(class_names)}")

        if self.config.target_classes:
            target_names = [class_names.get(c, "?") for c in self.config.target_classes]
            logger.info(f"Classi filtrate: {target_names}")
        else:
            logger.info("Nessun filtro classi attivo — rilevo tutto.")

    def detect_and_track(self, frame: np.ndarray) -> list[Detection]:
        """
        Esegue detection + tracking su un singolo frame.

        Args:
            frame: Frame BGR da OpenCV.

        Returns:
            Lista di Detection con tracking ID persistente.
        """
        if self.model is None:
            return []

        # Esegui tracking (detection + associazione ID)
        results = self.model.track(
            source=frame,
            persist=True,                          # Mantieni tracking tra frame
            conf=self.config.yolo_confidence,
            device=self.config.yolo_device,
            tracker=self.config.tracker_type,
            classes=self.config.target_classes,     # Filtra classi (None = tutte)
            verbose=False,                         # No output console per ogni frame
        )

        detections: list[Detection] = []

        if not results or len(results) == 0:
            return detections

        result = results[0]

        # Estrai boxes con tracking
        if result.boxes is None or len(result.boxes) == 0:
            return detections

        boxes = result.boxes
        for i in range(len(boxes)):
            # Coordinate bounding box
            x1, y1, x2, y2 = boxes.xyxy[i].cpu().numpy().astype(int)

            # Classe e confidenza
            class_id = int(boxes.cls[i].cpu().numpy())
            confidence = float(boxes.conf[i].cpu().numpy())
            class_name = self.model.names.get(class_id, f"class_{class_id}")

            # Tracking ID (-1 se il tracker non ha assegnato un ID)
            track_id = -1
            if boxes.id is not None:
                track_id = int(boxes.id[i].cpu().numpy())

            # Punti di riferimento
            cx = (x1 + x2) // 2
            cy = (y1 + y2) // 2
            bx = cx
            by = y2  # Bottom center

            detection = Detection(
                track_id=track_id,
                class_id=class_id,
                class_name=class_name,
                confidence=confidence,
                bbox=(x1, y1, x2, y2),
                center=(cx, cy),
                bottom_center=(bx, by),
            )
            detections.append(detection)

        return detections

    def draw_detections(
        self,
        frame: np.ndarray,
        detections: list[Detection],
    ) -> np.ndarray:
        """
        Disegna bounding box, tracker ID e info su un frame.

        Args:
            frame: Frame BGR originale.
            detections: Lista di detection da visualizzare.

        Returns:
            Frame con overlay grafico.
        """
        overlay = frame.copy()

        for det in detections:
            x1, y1, x2, y2 = det.bbox
            color = self.COLORS[det.track_id % len(self.COLORS)] if det.track_id >= 0 else (128, 128, 128)

            # Bounding box
            cv2.rectangle(overlay, (x1, y1), (x2, y2), color, 2)

            # Label con sfondo
            label = f"ID:{det.track_id} {det.class_name} {det.confidence:.0%}"
            label_size, _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
            label_w, label_h = label_size

            # Sfondo label
            cv2.rectangle(
                overlay,
                (x1, y1 - label_h - 10),
                (x1 + label_w + 6, y1),
                color,
                -1,
            )
            # Testo label
            cv2.putText(
                overlay,
                label,
                (x1 + 3, y1 - 5),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2,
            )

            # Punto bottom_center (per ROI matching futuro)
            cv2.circle(overlay, det.bottom_center, 5, color, -1)

        # Info overlay in alto a sinistra
        info = f"Oggetti rilevati: {len(detections)}"
        cv2.putText(
            overlay,
            info,
            (10, 30),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (0, 255, 0),
            2,
        )

        return overlay
