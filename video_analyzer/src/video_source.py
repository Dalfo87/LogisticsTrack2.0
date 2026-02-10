"""
LogisticsTrack — Video Source Manager
Gestisce l'acquisizione frame da file MP4 o stream RTSP.
Include riconnessione automatica per stream RTSP.
"""

import time
import logging
import cv2
import numpy as np

from config import VideoAnalyzerConfig

logger = logging.getLogger("VideoSource")


class VideoSource:
    """Sorgente video unificata per file e stream RTSP."""

    def __init__(self, config: VideoAnalyzerConfig) -> None:
        self.config = config
        self.cap: cv2.VideoCapture | None = None
        self._connect()

    def _connect(self) -> bool:
        """Apre la connessione alla sorgente video."""
        source = self.config.video_source
        logger.info(f"Connessione a sorgente video: {source}")

        if self.config.is_rtsp:
            # Per RTSP usiamo FFMPEG backend e buffer minimo
            self.cap = cv2.VideoCapture(source, cv2.CAP_FFMPEG)
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        else:
            self.cap = cv2.VideoCapture(source)

        if not self.cap.isOpened():
            logger.error(f"Impossibile aprire la sorgente video: {source}")
            return False

        # Leggi info video
        fps = self.cap.get(cv2.CAP_PROP_FPS)
        width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        logger.info(f"Video aperto: {width}x{height} @ {fps:.1f} FPS")
        return True

    def read_frame(self) -> np.ndarray | None:
        """
        Legge un frame dalla sorgente.
        Ritorna il frame (numpy array BGR) o None se non disponibile.
        Per RTSP, tenta la riconnessione automatica in caso di errore.
        """
        if self.cap is None or not self.cap.isOpened():
            if self.config.is_rtsp:
                return self._reconnect()
            return None

        ret, frame = self.cap.read()

        if not ret:
            if self.config.is_rtsp:
                logger.warning("Frame perso su stream RTSP. Riconnessione...")
                return self._reconnect()
            else:
                # File terminato
                logger.info("Fine del file video.")
                return None

        # Ridimensiona se necessario
        h, w = frame.shape[:2]
        target_w = self.config.frame_width
        target_h = self.config.frame_height
        if w != target_w or h != target_h:
            frame = cv2.resize(frame, (target_w, target_h))

        return frame

    def _reconnect(self) -> np.ndarray | None:
        """Tenta la riconnessione allo stream RTSP."""
        delay = self.config.rtsp_reconnect_delay
        logger.info(f"Tentativo riconnessione RTSP tra {delay}s...")
        self.release()
        time.sleep(delay)

        if self._connect():
            return self.read_frame()
        return None

    def is_open(self) -> bool:
        """True se la sorgente è attiva."""
        return self.cap is not None and self.cap.isOpened()

    def get_fps(self) -> float:
        """FPS della sorgente video."""
        if self.cap is not None:
            return self.cap.get(cv2.CAP_PROP_FPS) or 30.0
        return 30.0

    def release(self) -> None:
        """Rilascia le risorse video."""
        if self.cap is not None:
            self.cap.release()
            self.cap = None
            logger.info("Sorgente video rilasciata.")
