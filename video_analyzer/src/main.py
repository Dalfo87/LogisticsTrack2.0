"""
LogisticsTrack — Video Analyzer
Entry point principale. Orchestra la pipeline:
Video Source → YOLO Detection/Tracking → ROI Engine → MQTT Events → Display.

Fase 1: MVP con visualizzazione locale. ✅
Fase 2: ROI engine + pubblicazione MQTT. ✅
"""

import sys
import time
import signal
import logging

import cv2

from config import VideoAnalyzerConfig
from video_source import VideoSource
from detector import Detector
from roi_engine import ROIEngine
from event_manager import EventManager

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
    logger.info("LogisticsTrack — Video Analyzer")
    logger.info("=" * 60)
    logger.info(f"Sorgente video: {config.video_source}")
    logger.info(f"Modello YOLO: {config.yolo_model}")
    logger.info(f"Device: {config.yolo_device}")
    logger.info(f"Confidence threshold: {config.yolo_confidence}")
    logger.info(f"Camera ID: {config.camera_id}")
    logger.info(f"ROI file: {config.roi_file}")
    logger.info(f"MQTT broker: {config.mqtt_broker}:{config.mqtt_port}")
    logger.info(f"Display attivo: {config.show_display}")
    logger.info("=" * 60)

    # 2. Inizializzazione componenti
    # Video source
    video = VideoSource(config)
    if not video.is_open():
        logger.error("Impossibile aprire la sorgente video. Uscita.")
        sys.exit(1)

    # YOLO detector
    detector = Detector(config)

    # ROI engine
    roi_engine = ROIEngine()
    roi_count = roi_engine.load_from_file(config.roi_file)
    if roi_count == 0:
        logger.warning("Nessuna ROI caricata. Il sistema rileverà oggetti ma non genererà eventi.")

    # Event manager (MQTT)
    event_manager = EventManager(config)
    mqtt_ok = event_manager.connect()
    if not mqtt_ok:
        logger.warning(
            "MQTT non disponibile. Il sistema continua senza pubblicazione eventi. "
            "Gli eventi saranno visibili solo nel log."
        )

    # Metriche
    fps_counter = 0
    fps_timer = time.time()
    current_fps = 0.0
    total_events = 0

    logger.info("Pipeline avviata. Premi 'q' per uscire, 'p' per pausa, 'r' per reset ROI states.")

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

            # ROI processing → genera eventi
            events = roi_engine.process_detections(detections)

            # Pubblica eventi su MQTT
            if events:
                published = event_manager.publish_events(events)
                total_events += published
                for evt in events:
                    logger.info(
                        f"[EVENT] {evt.event_type} | "
                        f"track={evt.track_id} | "
                        f"roi={evt.roi_name} (aisle={evt.aisle_id}) | "
                        f"dwell={evt.dwell_seconds:.1f}s | "
                        f"conf={evt.confidence:.0%}"
                    )

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

                # Disegna ROI overlay
                if roi_count > 0:
                    roi_engine.draw_rois(display_frame, detections)

                # Info overlay
                cv2.putText(
                    display_frame,
                    f"FPS: {current_fps:.1f}",
                    (10, 60),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.8,
                    (0, 255, 255),
                    2,
                )

                # Stato MQTT
                mqtt_status = "MQTT: ON" if event_manager.is_connected else "MQTT: OFF"
                mqtt_color = (0, 255, 0) if event_manager.is_connected else (0, 0, 255)
                cv2.putText(
                    display_frame,
                    mqtt_status,
                    (10, 90),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    mqtt_color,
                    2,
                )

                # Contatore eventi
                cv2.putText(
                    display_frame,
                    f"Eventi: {total_events}",
                    (10, 115),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (255, 200, 100),
                    2,
                )

                cv2.imshow("LogisticsTrack — Video Analyzer", display_frame)

                # Gestione tasti
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    logger.info("Tasto 'q' premuto. Chiusura.")
                    break
                elif key == ord("p"):
                    logger.info("PAUSA — Premi qualsiasi tasto per continuare.")
                    cv2.waitKey(0)
                elif key == ord("r"):
                    roi_engine.reset()
                    total_events = 0
                    logger.info("Stati ROI resettati manualmente.")

    except Exception as e:
        logger.error(f"Errore critico nella pipeline: {e}", exc_info=True)

    finally:
        # Cleanup
        event_manager.disconnect()
        video.release()
        cv2.destroyAllWindows()
        logger.info(f"Video Analyzer terminato. Totale eventi generati: {total_events}")


if __name__ == "__main__":
    main()
