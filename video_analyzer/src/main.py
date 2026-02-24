"""
LogisticsTrack — Video Analyzer
Entry point principale. Orchestra la pipeline modulare:

  VideoSource → YOLO Detector → [Modulo 1, Modulo 2, ...] → EventManager → StreamServer

Ogni modulo è indipendente e implementa BaseVideoModule.
I moduli attivi sono configurati in data/modules.json.

Fasi completate:
- Fase 1: MVP con visualizzazione locale ✅
- Fase 2: ROI engine + pubblicazione MQTT ✅
- Fase 3-8: Backend, Frontend, Settings, SSE, ROI Editor ✅
- Fase 9: Architettura modulare + No Entry Filter ✅
"""

import json
import logging
import os
import signal
import sys
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from config import VideoAnalyzerConfig
from detector import Detector
from event_manager import EventManager
from modules.base import BaseEvent, BaseVideoModule, FrameMeta
from video_source import VideoSource
import stream_server

# Configurazione logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("VideoAnalyzer")

# Flag per shutdown pulito
_shutdown = False


def signal_handler(sig: int, frame: Any) -> None:
    """Gestione CTRL+C / SIGTERM per chiusura pulita."""
    global _shutdown
    logger.info("Ricevuto segnale di stop. Chiusura in corso...")
    _shutdown = True


signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)


# ---------------------------------------------------------------------------
# Caricamento moduli
# ---------------------------------------------------------------------------

def _load_modules(modules_file: str) -> list[BaseVideoModule]:
    """
    Legge data/modules.json e istanzia i moduli di analisi abilitati.

    I moduli non riconosciuti vengono ignorati con un warning.
    Se il file non esiste, carica il solo modulo 'logistics' con configurazione default.

    Args:
        modules_file: Path del file JSON di configurazione moduli.

    Returns:
        Lista di istanze BaseVideoModule inizializzate e pronte.
    """
    # Registro locale dei moduli disponibili
    from modules.logistics import LogisticsModule
    from modules.no_entry_filter import NoEntryFilterModule

    MODULE_REGISTRY: dict[str, type[BaseVideoModule]] = {
        "logistics": LogisticsModule,
        "no_entry_filter": NoEntryFilterModule,
    }

    # Default se il file non esiste
    _default_config: dict = {
        "modules": [
            {"type": "logistics", "enabled": True, "config": {"roi_file": "data/rois.json"}}
        ]
    }

    # Leggi configurazione
    cfg: dict
    try:
        with open(modules_file, encoding="utf-8") as f:
            cfg = json.load(f)
        logger.info(f"Configurazione moduli caricata da {modules_file}")
    except FileNotFoundError:
        logger.warning(
            f"File modules.json non trovato ({modules_file}). "
            "Uso configurazione default: solo modulo 'logistics'."
        )
        cfg = _default_config
    except json.JSONDecodeError as e:
        logger.error(f"Errore parsing {modules_file}: {e}. Uso configurazione default.")
        cfg = _default_config

    modules: list[BaseVideoModule] = []
    for mc in cfg.get("modules", []):
        if not mc.get("enabled", True):
            logger.info(f"Modulo '{mc.get('type', '?')}': disabilitato, skip.")
            continue

        mtype = mc.get("type", "")
        cls = MODULE_REGISTRY.get(mtype)
        if cls is None:
            logger.warning(
                f"Tipo modulo sconosciuto: '{mtype}'. "
                f"Tipi disponibili: {list(MODULE_REGISTRY.keys())}"
            )
            continue

        try:
            m = cls()
            m.initialize(mc.get("config", {}))
            modules.append(m)
            logger.info(f"Modulo caricato: {mtype}")
        except Exception as e:
            logger.error(f"Errore inizializzazione modulo '{mtype}': {e}", exc_info=True)

    if not modules:
        logger.warning("Nessun modulo attivo. La pipeline processerà i frame senza generare eventi.")

    return modules


# ---------------------------------------------------------------------------
# Crop salvataggio eventi
# ---------------------------------------------------------------------------

def _save_event_crop(
    frame: np.ndarray,
    event: BaseEvent,
    config: VideoAnalyzerConfig,
) -> None:
    """
    Salva il crop del bbox dell'evento come file JPEG.

    Compatibile con BaseEvent (schema v2.0).
    Il file viene salvato in {crops_dir}/{camera_id}/ con nome
    {timestamp_epoch}_{track_id}.jpg.
    Imposta event.crop_filename con il path relativo.
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

        # Nome file: {timestamp_epoch_trackid}.jpg
        ts_str = f"{event.timestamp:.3f}".replace(".", "_")
        filename = f"{ts_str}_{event.track_id}.jpg"
        filepath = camera_dir / filename

        # Salva JPEG compresso (qualità 80%)
        cv2.imwrite(str(filepath), crop, [cv2.IMWRITE_JPEG_QUALITY, 80])

        # Imposta il crop_filename relativo
        event.crop_filename = f"{event.camera_id}/{filename}"

        logger.debug(f"Crop salvato: {event.crop_filename}")

    except Exception as e:
        logger.error(f"Errore salvataggio crop evento: {e}")


# ---------------------------------------------------------------------------
# Pipeline principale
# ---------------------------------------------------------------------------

def main() -> bool:
    """
    Pipeline principale del Video Analyzer.

    Flusso:
    1. Carica configurazione + moduli
    2. Inizializza VideoSource, Detector, EventManager, StreamServer
    3. Loop: leggi frame → detect → ogni modulo process_frame → pubblica eventi
    4. Cleanup su uscita

    Returns:
        True se il loop si è interrotto per un restart richiesto via API.
        False in tutti gli altri casi (shutdown, fine file, errore critico).
    """
    global _shutdown
    _restart_requested = False

    # 1. Configurazione
    config = VideoAnalyzerConfig()
    logger.info("=" * 60)
    logger.info("LogisticsTrack — Video Analyzer (Architettura Modulare)")
    logger.info("=" * 60)
    logger.info(f"Sorgente video:   {config.video_source}")
    logger.info(f"Modello YOLO:     {config.yolo_model}")
    logger.info(f"Device:           {config.yolo_device}")
    logger.info(f"Confidence:       {config.yolo_confidence}")
    logger.info(f"Camera ID:        {config.camera_id}")
    logger.info(f"Moduli config:    {config.modules_file}")
    logger.info(f"MQTT broker:      {config.mqtt_broker}:{config.mqtt_port}")
    logger.info(f"Display attivo:   {config.show_display}")
    logger.info("=" * 60)

    # 2. Carica moduli di analisi
    modules = _load_modules(config.modules_file)
    logger.info(f"Moduli attivi: {[m.module_type for m in modules]}")

    # 3. Inizializzazione componenti core
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

    # Event manager (MQTT) — ora pubblica BaseEvent con schema v2.0
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
    frame_idx = 0

    logger.info("Pipeline avviata. Premi 'q' per uscire, 'p' per pausa, 'r' per reset stati.")

    # 4. Loop principale
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

            # Parametri runtime (aggiornabili via Settings UI)
            rt_cfg = stream_server.get_runtime_config() if config.stream_enabled else {}

            # Detection + Tracking con parametri runtime
            detections = detector.detect_and_track(
                frame,
                conf_override=rt_cfg.get("confidence"),
                iou_override=rt_cfg.get("iou"),
                classes_override=rt_cfg.get("target_classes"),
            )

            # Metadata del frame corrente
            meta = FrameMeta(
                timestamp=time.time(),
                frame_idx=frame_idx,
                camera_id=config.camera_id,
                width=frame.shape[1],
                height=frame.shape[0],
            )
            frame_idx += 1

            # Esegui tutti i moduli attivi + accumula eventi
            all_events: list[BaseEvent] = []
            display_frame = detector.draw_detections(frame, detections, visual_cfg=rt_cfg)

            for module in modules:
                module_events = module.process_frame(frame, detections, meta)
                all_events.extend(module_events)
                display_frame = module.draw_overlay(display_frame, module_events)

            # Salva crop + pubblica eventi
            if all_events:
                for evt in all_events:
                    _save_event_crop(frame, evt, config)

                published = event_manager.publish_events(all_events)
                total_events += published

                for evt in all_events:
                    logger.info(
                        f"[EVENT] {evt.module_type}/{evt.event_type} | "
                        f"track={evt.track_id} | "
                        f"conf={evt.confidence:.0%} | "
                        f"data={evt.event_data}"
                    )

            # Hot-reload ROI (segnale dal backend via MQTT)
            if event_manager.roi_reload_requested:
                logger.info("Hot-reload ROI richiesto via MQTT — propagazione ai moduli...")
                for module in modules:
                    module.on_reload_signal()
                event_manager.acknowledge_reload()

            # Calcolo FPS reali
            fps_counter += 1
            elapsed = time.time() - fps_timer
            if elapsed >= 1.0:
                current_fps = fps_counter / elapsed
                fps_counter = 0
                fps_timer = time.time()

            # Info overlay (FPS, MQTT, eventi) — controllato da show_overlay
            if rt_cfg.get("show_overlay", True):
                cv2.putText(
                    display_frame, f"FPS: {current_fps:.1f}",
                    (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2,
                )
                mqtt_status = "MQTT: ON" if event_manager.is_connected else "MQTT: OFF"
                mqtt_color = (0, 255, 0) if event_manager.is_connected else (0, 0, 255)
                cv2.putText(
                    display_frame, mqtt_status,
                    (10, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.6, mqtt_color, 2,
                )
                cv2.putText(
                    display_frame, f"Events: {total_events}",
                    (10, 115), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 200, 100), 2,
                )
                # Mostra moduli attivi nell'overlay
                modules_str = " | ".join(m.module_type for m in modules) or "nessuno"
                cv2.putText(
                    display_frame, f"Moduli: {modules_str}",
                    (10, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1,
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
                    for module in modules:
                        module.reset()
                    total_events = 0
                    frame_idx = 0
                    logger.info("Stati di tutti i moduli resettati manualmente.")

            # Controlla se è stato richiesto un restart via stream server API
            if config.stream_enabled and stream_server.is_restart_requested():
                logger.info("Restart richiesto via API. Chiusura loop in corso...")
                stream_server.acknowledge_restart()
                _restart_requested = True
                break

    except Exception as e:
        logger.error(f"Errore critico nella pipeline: {e}", exc_info=True)

    finally:
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
