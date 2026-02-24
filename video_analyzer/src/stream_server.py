"""
LogisticsTrack — Stream Server
Server HTTP leggero per lo streaming MJPEG del flusso video annotato da YOLO.
Gira in un thread daemon separato rispetto al loop principale.

Espone anche API REST per la configurazione runtime di YOLO e per richiedere
il restart del processo di analisi.
"""

import asyncio
import json
import logging
import threading
from pathlib import Path
from typing import AsyncGenerator

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

logger = logging.getLogger("StreamServer")

# ---------------------------------------------------------------------------
# Shared state thread-safe
# ---------------------------------------------------------------------------
_latest_frame: np.ndarray | None = None
_frame_lock = threading.Lock()

_runtime_config: dict = {
    # --- Parametri YOLO (live, no restart) ---
    "confidence": 0.4,
    "iou": 0.45,
    "target_classes": None,     # None = tutte le classi
    # --- Modello (richiede restart) ---
    "model_path": None,         # None = usa YOLO_MODEL da .env
    # --- Visualizzazione bounding box (live, no restart) ---
    "bbox_thickness": 2,        # Spessore linea bbox  (1–8)
    "font_scale": 0.6,          # Dimensione testo     (0.3–1.5)
    "font_thickness": 2,        # Spessore testo       (1–4)
    "show_label": True,         # Mostra etichetta classe/ID/conf
    "show_dot": True,           # Mostra punto bottom_center
    # --- Stream MJPEG ---
    "jpeg_quality": 65,         # Qualità JPEG stream  (20–95)
    "show_overlay": True,       # Mostra overlay FPS/MQTT sul frame
}
_config_lock = threading.Lock()

# File di persistenza: video_analyzer/data/runtime_config.json
_RUNTIME_CFG_FILE = Path(__file__).resolve().parent.parent / "data" / "runtime_config.json"


def _load_persisted_config() -> None:
    """
    Carica la configurazione runtime da disco al primo avvio del processo.
    Aggiorna solo le chiavi presenti sia nel file salvato che in _runtime_config
    (ignora chiavi sconosciute per forward/backward compatibility).
    """
    if not _RUNTIME_CFG_FILE.exists():
        return
    try:
        saved = json.loads(_RUNTIME_CFG_FILE.read_text(encoding="utf-8"))
        with _config_lock:
            for key in _runtime_config:
                if key in saved:
                    _runtime_config[key] = saved[key]
        logger.info(f"Runtime config caricato da {_RUNTIME_CFG_FILE.name}")
    except Exception as e:
        logger.warning(f"Impossibile caricare runtime config da disco: {e}")


def _save_persisted_config() -> None:
    """
    Salva la configurazione runtime corrente su disco.
    Chiamata dopo ogni aggiornamento via PATCH /config.
    """
    try:
        _RUNTIME_CFG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with _config_lock:
            data = dict(_runtime_config)
        _RUNTIME_CFG_FILE.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )
    except Exception as e:
        logger.warning(f"Impossibile salvare runtime config su disco: {e}")


# Classi del modello corrente (aggiornate da main.py dopo ogni caricamento)
_current_model_names: dict[int, str] = {}

_restart_requested = threading.Event()
_server_started = False          # Guard: avvia il server una sola volta

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
_app = FastAPI(title="LogisticsTrack Stream Server", docs_url=None, redoc_url=None)

_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "PATCH", "POST"],
    allow_headers=["*"],
)


async def _generate_mjpeg() -> AsyncGenerator[bytes, None]:
    """
    Generatore asincrono di frame MJPEG.
    Cappato a ~10fps con asyncio.sleep(0.1) per minimizzare CPU.
    """
    while True:
        with _frame_lock:
            frame = _latest_frame

        if frame is not None:
            with _config_lock:
                quality = _runtime_config.get("jpeg_quality", 65)
            success, buffer = cv2.imencode(
                ".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality]
            )
            if success:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n"
                    + buffer.tobytes()
                    + b"\r\n"
                )

        # Cap a ~10fps
        await asyncio.sleep(0.1)


@_app.get("/stream")
async def video_stream():
    """Stream MJPEG del flusso video annotato da YOLO (10fps cap)."""
    return StreamingResponse(
        _generate_mjpeg(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache, no-store"},
    )


# ---------------------------------------------------------------------------
# Runtime YOLO config endpoints
# ---------------------------------------------------------------------------
class YOLORuntimeConfig(BaseModel):
    """Parametri aggiornabili a runtime.

    Live (senza restart): confidence, iou, target_classes, bbox_*, show_*, jpeg_quality.
    Con restart (POST /restart): model_path.
    """
    # YOLO
    confidence:       float | None = Field(default=None, ge=0.1, le=1.0)
    iou:              float | None = Field(default=None, ge=0.1, le=1.0)
    target_classes:   list[int] | None = None
    model_path:       str | None = None
    # Visualizzazione bbox
    bbox_thickness:   int   | None = Field(default=None, ge=1, le=8)
    font_scale:       float | None = Field(default=None, ge=0.3, le=1.5)
    font_thickness:   int   | None = Field(default=None, ge=1, le=4)
    show_label:       bool  | None = None
    show_dot:         bool  | None = None
    # Stream
    jpeg_quality:     int   | None = Field(default=None, ge=20, le=95)
    show_overlay:     bool  | None = None


@_app.get("/config")
async def get_config():
    """Restituisce la configurazione runtime corrente di YOLO."""
    with _config_lock:
        return dict(_runtime_config)


@_app.patch("/config")
async def update_config(new_cfg: YOLORuntimeConfig):
    """
    Aggiorna i parametri YOLO.
    confidence, iou, target_classes: applicati live (nessun restart).
    model_path: salvato in config, applicato al prossimo POST /restart.
    """
    with _config_lock:
        # target_classes e model_path possono essere esplicitamente None
        nullable_settable = {"target_classes", "model_path"}
        for field_name in new_cfg.model_fields_set:
            value = getattr(new_cfg, field_name)
            if field_name in nullable_settable:
                _runtime_config[field_name] = value          # anche None è valido
            elif value is not None:
                _runtime_config[field_name] = value          # ignora None per gli altri
        current = dict(_runtime_config)
    _save_persisted_config()  # persiste su disco per sopravvivere ai riavvii
    logger.info(f"Runtime config aggiornata: {current}")
    return current


@_app.get("/models")
async def list_models():
    """
    Elenca i modelli YOLO disponibili in video_analyzer/models/.
    Restituisce nome, path relativo (usabile come model_path) e dimensione.
    """
    models_dir = Path(__file__).resolve().parent.parent / "models"
    if not models_dir.exists():
        return []
    return [
        {
            "name": f.name,
            "path": f"models/{f.name}",
            "size_mb": round(f.stat().st_size / 1_000_000, 1),
        }
        for f in sorted(models_dir.glob("*.pt"))
    ]


@_app.get("/classes")
async def list_classes():
    """
    Restituisce le classi del modello YOLO correntemente caricato.
    Aggiornato da main.py via set_model_names() ad ogni avvio del Detector.
    """
    return [
        {"id": class_id, "name": name}
        for class_id, name in sorted(_current_model_names.items())
    ]


@_app.post("/restart")
async def request_restart():
    """Segnala al loop principale di fermarsi e riavviarsi."""
    _restart_requested.set()
    logger.info("Restart richiesto via API")
    return {"status": "restart_requested"}


@_app.get("/health")
async def health():
    """Stato del server e del flusso video."""
    with _frame_lock:
        has_frame = _latest_frame is not None
    return {"status": "ok", "stream_active": has_frame}


# ---------------------------------------------------------------------------
# Interfaccia pubblica per main.py
# ---------------------------------------------------------------------------
def push_frame(frame: np.ndarray) -> None:
    """
    Aggiorna l'ultimo frame disponibile per lo stream.
    Thread-safe. Chiamare ad ogni iterazione del loop principale.
    """
    global _latest_frame
    with _frame_lock:
        _latest_frame = frame.copy()


def get_runtime_config() -> dict:
    """
    Restituisce la configurazione runtime corrente.
    Thread-safe. Chiamare prima di ogni invocazione di detect_and_track().
    """
    with _config_lock:
        return dict(_runtime_config)


def is_restart_requested() -> bool:
    """True se è stato richiesto un restart via POST /restart."""
    return _restart_requested.is_set()


def acknowledge_restart() -> None:
    """Resetta il flag di restart dopo che il loop principale lo ha gestito."""
    _restart_requested.clear()


def set_model_names(names: dict[int, str]) -> None:
    """
    Aggiorna le classi del modello correntemente caricato.
    Thread-safe. Chiamare da main.py dopo ogni inizializzazione del Detector.
    """
    global _current_model_names
    _current_model_names = dict(names)


def start_stream_server(port: int, initial_config: dict | None = None) -> None:
    """
    Avvia il server MJPEG in un thread daemon.
    Idempotente: se il server è già in esecuzione non fa nulla.

    Args:
        port: Porta HTTP su cui ascoltare (default: 8765).
        initial_config: Configurazione runtime iniziale (sovrascrive i default).
                        Ignorata se il server è già avviato (i valori runtime
                        sopravvivono al restart del loop principale).
    """
    global _runtime_config, _server_started

    # Ripristina impostazioni salvate (prima del guard: aggiorna la memoria anche su restart loop)
    _load_persisted_config()

    if _server_started:
        logger.info("Stream server già in esecuzione — skip avvio.")
        return

    if initial_config:
        with _config_lock:
            _runtime_config.update(
                {k: v for k, v in initial_config.items() if k in _runtime_config}
            )

    uvicorn_config = uvicorn.Config(
        app=_app,
        host="0.0.0.0",
        port=port,
        log_level="warning",   # Silenzioso per non sporcare il log YOLO
        access_log=False,
    )
    server = uvicorn.Server(uvicorn_config)

    thread = threading.Thread(
        target=server.run,
        name="StreamServerThread",
        daemon=True,
    )
    thread.start()
    _server_started = True
    logger.info(f"Stream server avviato su http://0.0.0.0:{port}/stream")
