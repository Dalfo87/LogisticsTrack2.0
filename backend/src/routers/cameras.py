"""
LogisticsTrack — Cameras Router
API REST per gestione camere.
Include endpoints per gestione configurazione moduli (schema v2.0).
"""

import json
import logging
import os
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import paho.mqtt.client as mqtt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_session
from db.models import Camera
from models.schemas import CameraCreate, CameraResponse

logger = logging.getLogger("CamerasRouter")

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


@router.get("", response_model=list[CameraResponse])
async def list_cameras(
    session: AsyncSession = Depends(get_session),
) -> list[CameraResponse]:
    """Lista tutte le camere registrate."""
    result = await session.execute(select(Camera).order_by(Camera.name))
    cameras = result.scalars().all()
    return [CameraResponse.model_validate(c) for c in cameras]


@router.get("/{camera_id}", response_model=CameraResponse)
async def get_camera(
    camera_id: str,
    session: AsyncSession = Depends(get_session),
) -> CameraResponse:
    """Dettaglio singola camera."""
    result = await session.execute(select(Camera).where(Camera.id == camera_id))
    camera = result.scalar_one_or_none()

    if camera is None:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' non trovata")

    return CameraResponse.model_validate(camera)


@router.post("", response_model=CameraResponse, status_code=201)
async def create_camera(
    data: CameraCreate,
    session: AsyncSession = Depends(get_session),
) -> CameraResponse:
    """Registra una nuova camera."""
    # Verifica duplicato
    existing = await session.execute(select(Camera).where(Camera.id == data.id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Camera '{data.id}' già esistente")

    camera = Camera(**data.model_dump())
    session.add(camera)
    await session.commit()
    await session.refresh(camera)

    logger.info(f"Camera creata: {camera.id} — {camera.name}")
    return CameraResponse.model_validate(camera)


@router.put("/{camera_id}", response_model=CameraResponse)
async def update_camera(
    camera_id: str,
    data: CameraCreate,
    session: AsyncSession = Depends(get_session),
) -> CameraResponse:
    """Aggiorna una camera esistente."""
    result = await session.execute(select(Camera).where(Camera.id == camera_id))
    camera = result.scalar_one_or_none()

    if camera is None:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' non trovata")

    camera.name = data.name
    camera.rtsp_url = data.rtsp_url
    camera.location = data.location
    camera.is_active = data.is_active
    camera.modules_config = data.modules_config  # schema v2.0

    await session.commit()
    await session.refresh(camera)

    logger.info(f"Camera aggiornata: {camera.id}")
    return CameraResponse.model_validate(camera)


@router.delete("/{camera_id}", status_code=204)
async def delete_camera(
    camera_id: str,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Elimina una camera (cascade su ROI associate)."""
    result = await session.execute(select(Camera).where(Camera.id == camera_id))
    camera = result.scalar_one_or_none()

    if camera is None:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' non trovata")

    await session.delete(camera)
    await session.commit()

    logger.info(f"Camera eliminata: {camera_id}")


# ---------------------------------------------------------------------------
# Modules Config (schema v2.0)
# ---------------------------------------------------------------------------


@router.get("/{camera_id}/modules")
async def get_camera_modules(
    camera_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    Restituisce la configurazione moduli di una camera.

    Risposta: {"modules": [{"type": "logistics", "enabled": true, "config": {...}}, ...]}
    """
    result = await session.execute(select(Camera).where(Camera.id == camera_id))
    camera = result.scalar_one_or_none()

    if camera is None:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' non trovata")

    return camera.modules_config or {"modules": []}


@router.put("/{camera_id}/modules")
async def update_camera_modules(
    camera_id: str,
    data: dict[str, Any],
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    Aggiorna la configurazione moduli di una camera.

    Body: {"modules": [{"type": "logistics", "enabled": true, "config": {...}}, ...]}
    Non esegue l'export automatico: chiamare /modules/export per propagare al video analyzer.
    """
    result = await session.execute(select(Camera).where(Camera.id == camera_id))
    camera = result.scalar_one_or_none()

    if camera is None:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' non trovata")

    camera.modules_config = data
    await session.commit()
    await session.refresh(camera)

    logger.info(f"Configurazione moduli aggiornata per camera {camera_id}")
    return camera.modules_config or {"modules": []}


@router.post("/{camera_id}/modules/export")
async def export_camera_modules(
    camera_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    Esporta la configurazione moduli in data/modules.json per il video analyzer.
    Invia anche un segnale MQTT di reload.

    Il file viene scritto nel path configurato via env var MODULES_EXPORT_PATH
    (default: <repo_root>/video_analyzer/data/modules.json).
    """
    result = await session.execute(select(Camera).where(Camera.id == camera_id))
    camera = result.scalar_one_or_none()

    if camera is None:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' non trovata")

    modules_config = camera.modules_config or {"modules": []}

    # Risoluzione path export
    modules_file_path_str = os.getenv(
        "MODULES_EXPORT_PATH",
        str(Path(__file__).resolve().parent.parent.parent.parent / "video_analyzer" / "data" / "modules.json"),
    )
    modules_file_path = Path(modules_file_path_str)

    try:
        modules_file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(modules_file_path, "w", encoding="utf-8") as f:
            json.dump(modules_config, f, indent=4, ensure_ascii=False)
        logger.info(f"File modules.json scritto: {modules_file_path}")
    except Exception as e:
        logger.error(f"Errore scrittura modules.json: {e}")
        raise HTTPException(status_code=500, detail=f"Errore scrittura file moduli: {e}")

    # Invia segnale MQTT di reload moduli
    mqtt_sent = _send_mqtt_reload_modules_signal(camera_id)

    return {
        "camera_id": camera_id,
        "modules_count": len(modules_config.get("modules", [])),
        "file": str(modules_file_path),
        "mqtt_signal_sent": mqtt_sent,
    }


def _send_mqtt_reload_modules_signal(camera_id: str) -> bool:
    """Pubblica un messaggio MQTT per segnalare al video analyzer di ricaricare i moduli."""
    broker = os.getenv("MQTT_BROKER", "localhost")
    port = int(os.getenv("MQTT_PORT", "1883"))
    topic = "logistics/control/reload_modules"

    try:
        client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id="backend_modules_export",
            protocol=mqtt.MQTTv5,
        )
        client.connect(broker, port, keepalive=10)
        payload = json.dumps({"camera_id": camera_id, "action": "reload_modules"})
        result = client.publish(topic, payload, qos=1)
        client.disconnect()

        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            logger.info(f"Segnale MQTT reload moduli inviato per camera {camera_id}")
            return True
        else:
            logger.warning(f"Errore invio segnale MQTT reload moduli: rc={result.rc}")
            return False
    except Exception as e:
        logger.warning(f"MQTT non disponibile per segnale reload moduli: {e}")
        return False


# ---------------------------------------------------------------------------
# Snapshot
# ---------------------------------------------------------------------------


@router.get("/{camera_id}/snapshot")
async def get_camera_snapshot(
    camera_id: str,
    session: AsyncSession = Depends(get_session),
) -> Response:
    """
    Cattura un singolo frame dalla camera RTSP e lo restituisce come JPEG.
    Se la camera non è raggiungibile, restituisce un placeholder grigio.
    """
    result = await session.execute(select(Camera).where(Camera.id == camera_id))
    camera = result.scalar_one_or_none()

    if camera is None:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' non trovata")

    frame = None

    # Tenta di catturare un frame RTSP
    if camera.rtsp_url:
        try:
            # Timeout DEVE essere impostato PRIMA di aprire lo stream
            cap = cv2.VideoCapture()
            cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 3000)
            cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 3000)
            cap.open(camera.rtsp_url)
            if cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    frame = None
            cap.release()
        except Exception as e:
            logger.warning(f"Errore cattura snapshot da {camera_id}: {e}")
            frame = None

    # Fallback: immagine placeholder grigia
    if frame is None:
        frame = np.full((720, 1280, 3), 40, dtype=np.uint8)  # Grigio scuro
        text = "Camera non raggiungibile"
        font = cv2.FONT_HERSHEY_SIMPLEX
        text_size = cv2.getTextSize(text, font, 1.0, 2)[0]
        x = (1280 - text_size[0]) // 2
        y = (720 + text_size[1]) // 2
        cv2.putText(frame, text, (x, y), font, 1.0, (120, 120, 120), 2)

        # Nome camera
        cv2.putText(frame, f"[{camera_id}]", (x + 30, y + 40), font, 0.6, (80, 80, 80), 1)

    # Resize a 1280x720 se necessario
    if frame.shape[:2] != (720, 1280):
        frame = cv2.resize(frame, (1280, 720))

    # Codifica JPEG
    _, jpeg_data = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])

    return Response(
        content=jpeg_data.tobytes(),
        media_type="image/jpeg",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )
