"""
LogisticsTrack — Video Analyzer
Entry point principale. Orchestra la pipeline:
Video Source → YOLO Detection/Tracking → Display.

Fase 1: MVP con visualizzazione locale.
Fase 2: Aggiunta ROI engine + pubblicazione MQTT.
"""

import sys
import time
import signal
import logging

import cv2

from config import VideoAnalyzerConfig
from video_source import VideoSource
from detector import Detector

# Configurazione logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("VideoAnalyzer")

# Flag per shutdown pulito
_shutdown = False


def signal_handler(sig: int, frame) -> None:
    """Gestione CTRL+C per chiusura pulita."""
    global _shutdown
    logger.info("Ricevuto segnale di stop. Chiusura in corso...")
    _shutdown = True


signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)


def main() -> None:
    """Pipeline principale del Video Analyzer."""
    global _shutdown

    # 1. Configurazione
    config = VideoAnalyzerConfig()
    logger.info("=" * 60)
    logger.info("LogisticsTrack — Video Analyzer MVP")
    logger.info("=" * 60)
    logger.info(f"Sorgente video: {config.video_source}")
    logger.info(f"Modello YOLO: {config.yolo_model}")
    logger.info(f"Device: {config.yolo_device}")
    logger.info(f"Confidence threshold: {config.yolo_confidence}")
    logger.info(f"Display attivo: {config.show_display}")
    logger.info("=" * 60)

    # 2. Inizializzazione componenti
    video = VideoSource(config)
    if not video.is_open():
        logger.error("Impossibile aprire la sorgente video. Uscita.")
        sys.exit(1)

    detector = Detector(config)

    # Metriche FPS
    fps_counter = 0
    fps_timer = time.time()
    current_fps = 0.0

    logger.info("Pipeline avviata. Premi 'q' nella finestra video per uscire.")

    # 3. Loop principale
    try:
        while not _shutdown:
            # Leggi frame
            frame = video.read_frame()
            if frame is None:
                if config.is_file:
                    logger.info("Video terminato.")
                    break
                else:
                    # RTSP: la riconnessione è gestita da VideoSource
                    continue

            # Detection + Tracking
            detections = detector.detect_and_track(frame)

            # Calcolo FPS reali
            fps_counter += 1
            elapsed = time.time() - fps_timer
            if elapsed >= 1.0:
                current_fps = fps_counter / elapsed
                fps_counter = 0
                fps_timer = time.time()

            # Visualizzazione
            if config.show_display:
                display_frame = detector.draw_detections(frame, detections)

                # FPS overlay
                cv2.putText(
                    display_frame,
                    f"FPS: {current_fps:.1f}",
                    (10, 60),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.8,
                    (0, 255, 255),
                    2,
                )

                cv2.imshow("LogisticsTrack — Video Analyzer", display_frame)

                # Gestione tasti
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    logger.info("Tasto 'q' premuto. Chiusura.")
                    break
                elif key == ord("p"):
                    # Pausa
                    logger.info("PAUSA — Premi qualsiasi tasto per continuare.")
                    cv2.waitKey(0)

    except Exception as e:
        logger.error(f"Errore critico nella pipeline: {e}", exc_info=True)

    finally:
        # Cleanup
        video.release()
        cv2.destroyAllWindows()
        logger.info("Video Analyzer terminato.")


if __name__ == "__main__":
    main()
