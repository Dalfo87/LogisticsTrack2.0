"""
LogisticsTrack — Video Analyzer
Entry point principale. Orchestra la pipeline:
Video Source → YOLO Detection/Tracking → ROI Engine → MQTT Events → Display.

Fase 1: MVP con visualizzazione locale. ✅
Fase 2: ROI engine + pubblicazione MQTT. ✅
"""

import os
import sys
import time
import signal
import logging
from pathlib import Path

import cv2
import numpy as np

from config import VideoAnalyzerConfig
from video_source import VideoSource
from detector import Detector
from roi_engine import ROIEngine, ROIEvent
from event_manager import EventManager
import stream_server

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


def _save_event_crop(
    frame: np.ndarray,
    event: ROIEvent,
    config: VideoAnalyzerConfig,
) -> None:
    """
    Salva il crop del bbox dell'evento come file JPEG.

    Il file viene salvato in {crops_dir}/{camera_id}/ con nome
    {timestamp_epoch}_{track_id}.jpg.
    Imposta event.crop_filename con il path relativo (camera_id/filename).
    """
    try:
        x1, y1, x2, y2 = event.bbox
        h, w = frame.shape[:2]

        # Clamp coordinate dentro i limiti del frame
        x1 = max(0, min(x1, w - 1))
        y1 = max(0, min(y1, h - 1))
        x2 = max(0, min(x2, w))
        y2 = max(0, min(y2, h))

        if x2 <= x1 or y2 <= y1:
            logger.warning(f"Bbox non valido per crop: ({x1},{y1},{x2},{y2})")
            return

        crop = frame[y1:y2, x1:x2]

        # Crea directory se non esiste
        camera_dir = Path(config.crops_dir) / event.camera_id
        camera_dir.mkdir(parents=True, exist_ok=True)

        # Nome file: timestamp_epoch_trackid.jpg
        ts_str = f"{event.timestamp:.3f}".replace(".", "_")
        filename = f"{ts_str}_{event.track_id}.jpg"
        filepath = camera_dir / filename

        # Salva JPEG compresso (qualità 80%)
        cv2.imwrite(str(filepath), crop, [cv2.IMWRITE_JPEG_QUALITY, 80])

        # Imposta il crop_filename relativo (camera_id/filename)
        event.crop_filename = f"{event.camera_id}/{filename}"

        logger.debug(f"Crop salvato: {event.crop_filename}")

    except Exception as e:
        logger.error(f"Errore salvataggio crop evento: {e}")


def main() -> bool:
    """
    Pipeline principale del Video Analyzer.

    Returns:
        True se il loop si è interrotto per un restart richiesto via API
        (il chiamante deve richiamare main() per riprendere con il nuovo modello).
        False in tutti gli altri casi (shutdown normale, fine file, errore critico).
    """
    global _shutdown
    _restart_requested = False

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

    # YOLO detector — usa model_path dal runtime config se impostato (cambio modello via UI)
    rt_model_path: str | None = None
    if config.stream_enabled:
        rt_model_path = stream_server.get_runtime_config().get("model_path")
    detector = Detector(config, model_path_override=rt_model_path)

    # Pubblica le classi del modello allo stream server (per endpoint /classes)
    if config.stream_enabled and detector.model is not None:
        stream_server.set_model_names(detector.model.names)

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

    # Stream server MJPEG
    if config.stream_enabled:
        stream_server.start_stream_server(
            port=config.stream_port,
            initial_config={
                "confidence": config.yolo_confidence,
                "iou": config.yolo_iou,
                "target_classes": config.target_classes,
            },
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

            # Detection + Tracking (con parametri runtime aggiornabili via API)
            rt_cfg = stream_server.get_runtime_config() if config.stream_enabled else {}
            detections = detector.detect_and_track(
                frame,
                conf_override=rt_cfg.get("confidence"),
                iou_override=rt_cfg.get("iou"),
                classes_override=rt_cfg.get("target_classes"),
            )

            # ROI processing → genera eventi
            events = roi_engine.process_detections(detections)

            # Salva crop immagini + Pubblica eventi su MQTT
            if events:
                for evt in events:
                    _save_event_crop(frame, evt, config)

                published = event_manager.publish_events(events)
                total_events += published
                for evt in events:
                    logger.info(
                        f"[EVENT] {evt.event_type} | "
                        f"track={evt.track_id} | "
                        f"roi={evt.roi_name} (aisle={evt.aisle_id}) | "
                        f"dwell={evt.dwell_seconds:.1f}s | "
                        f"conf={evt.confidence:.0%} | "
                        f"label={evt.label}"
                    )

            # Hot-reload ROI (segnale dal backend via MQTT)
            if event_manager.roi_reload_requested:
                roi_engine.clear_all()
                roi_count = roi_engine.load_from_file(config.roi_file)
                event_manager.acknowledge_reload()
                logger.info(f"ROI ricaricate da segnale MQTT: {roi_count} definizioni")

            # Calcolo FPS reali
            fps_counter += 1
            elapsed = time.time() - fps_timer
            if elapsed >= 1.0:
                current_fps = fps_counter / elapsed
                fps_counter = 0
                fps_timer = time.time()

            # Costruisci il frame annotato (sempre, non solo se show_display=True)
            # — serve sia per il display locale che per lo stream web
            display_frame = detector.draw_detections(frame, detections, visual_cfg=rt_cfg)

            if roi_count > 0:
                roi_engine.draw_rois(display_frame, detections)

            # Info overlay (FPS, MQTT, eventi) — controllato da show_overlay
            if rt_cfg.get("show_overlay", True):
                cv2.putText(
                    display_frame,
                    f"FPS: {current_fps:.1f}",
                    (10, 60),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.8,
                    (0, 255, 255),
                    2,
                )
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
                cv2.putText(
                    display_frame,
                    f"Eventi: {total_events}",
                    (10, 115),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (255, 200, 100),
                    2,
                )

            # Invia frame allo stream server web (MJPEG)
            if config.stream_enabled:
                stream_server.push_frame(display_frame)

            # Display locale (solo se SHOW_DISPLAY=true)
            if config.show_display:
                cv2.imshow("LogisticsTrack — Video Analyzer", display_frame)
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

            # Controlla se è stato richiesto un restart via stream server API
            if config.stream_enabled and stream_server.is_restart_requested():
                logger.info("Restart richiesto via API. Chiusura loop in corso...")
                stream_server.acknowledge_restart()
                _restart_requested = True
                break

    except Exception as e:
        logger.error(f"Errore critico nella pipeline: {e}", exc_info=True)

    finally:
        # Cleanup
        event_manager.disconnect()
        video.release()
        cv2.destroyAllWindows()
        logger.info(f"Video Analyzer terminato. Totale eventi generati: {total_events}")

    return _restart_requested


if __name__ == "__main__":
    while True:
        should_restart = main()
        if not should_restart:
            break
        logger.info("=" * 60)
        logger.info("Riavvio pipeline con nuovo modello in corso...")
        logger.info("=" * 60)
