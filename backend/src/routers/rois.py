"""
LogisticsTrack — ROIs Router
API REST per gestione ROI (Region of Interest).
Include CRUD completo e export verso il video analyzer.
"""

import json
import logging
import os
from pathlib import Path
from typing import Optional

import paho.mqtt.client as mqtt
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_session
from db.models import ROI, Camera
from models.schemas import ROICreate, ROIResponse

logger = logging.getLogger("ROIsRouter")

router = APIRouter(prefix="/api/rois", tags=["rois"])


# ---------------------------------------------------------------------------
# CRUD Endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[ROIResponse])
async def list_rois(
    camera_id: Optional[str] = None,
    module_type: Optional[str] = None,
    session: AsyncSession = Depends(get_session),
) -> list[ROIResponse]:
    """
    Lista ROI, con filtro opzionale per camera e/o modulo.

    Parametri:
        camera_id:   Filtra per camera ID (match esatto).
        module_type: Filtra per modulo ("logistics", "no_entry_filter", ...).
                     Se assente, restituisce ROI di tutti i moduli.
    """
    query = select(ROI).order_by(ROI.name)

    if camera_id:
        query = query.where(ROI.camera_id == camera_id)
    if module_type:
        query = query.where(ROI.module_type == module_type)

    result = await session.execute(query)
    rois = result.scalars().all()
    return [ROIResponse.model_validate(r) for r in rois]


@router.get("/{roi_id}", response_model=ROIResponse)
async def get_roi(
    roi_id: int,
    session: AsyncSession = Depends(get_session),
) -> ROIResponse:
    """Dettaglio singola ROI."""
    result = await session.execute(select(ROI).where(ROI.id == roi_id))
    roi = result.scalar_one_or_none()

    if roi is None:
        raise HTTPException(status_code=404, detail=f"ROI {roi_id} non trovata")

    return ROIResponse.model_validate(roi)


@router.post("", response_model=ROIResponse, status_code=201)
async def create_roi(
    data: ROICreate,
    session: AsyncSession = Depends(get_session),
) -> ROIResponse:
    """Crea una nuova ROI."""
    # Verifica che la camera esista
    cam_result = await session.execute(select(Camera).where(Camera.id == data.camera_id))
    if cam_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"Camera '{data.camera_id}' non trovata")

    roi = ROI(**data.model_dump())
    session.add(roi)
    await session.commit()
    await session.refresh(roi)

    logger.info(f"ROI creata: {roi.id} — {roi.name} (camera: {roi.camera_id})")
    return ROIResponse.model_validate(roi)


@router.put("/{roi_id}", response_model=ROIResponse)
async def update_roi(
    roi_id: int,
    data: ROICreate,
    session: AsyncSession = Depends(get_session),
) -> ROIResponse:
    """Aggiorna una ROI esistente."""
    result = await session.execute(select(ROI).where(ROI.id == roi_id))
    roi = result.scalar_one_or_none()

    if roi is None:
        raise HTTPException(status_code=404, detail=f"ROI {roi_id} non trovata")

    roi.camera_id = data.camera_id
    roi.name = data.name
    roi.aisle_id = data.aisle_id
    roi.points = data.points
    roi.is_active = data.is_active
    roi.module_type = data.module_type  # schema v2.0

    await session.commit()
    await session.refresh(roi)

    logger.info(f"ROI aggiornata: {roi.id} — {roi.name}")
    return ROIResponse.model_validate(roi)


@router.delete("/{roi_id}", status_code=204)
async def delete_roi(
    roi_id: int,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Elimina una ROI."""
    result = await session.execute(select(ROI).where(ROI.id == roi_id))
    roi = result.scalar_one_or_none()

    if roi is None:
        raise HTTPException(status_code=404, detail=f"ROI {roi_id} non trovata")

    await session.delete(roi)
    await session.commit()

    logger.info(f"ROI eliminata: {roi_id}")


# ---------------------------------------------------------------------------
# Export verso Video Analyzer
# ---------------------------------------------------------------------------


@router.post("/export/{camera_id}")
async def export_rois(
    camera_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    Esporta le ROI di una camera nel formato rois.json per il video analyzer.
    Scrive il file e invia un segnale MQTT di reload.
    """
    # Verifica che la camera esista
    cam_result = await session.execute(select(Camera).where(Camera.id == camera_id))
    if cam_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' non trovata")

    # Recupera tutte le ROI per la camera
    result = await session.execute(
        select(ROI).where(ROI.camera_id == camera_id).order_by(ROI.name)
    )
    rois = result.scalars().all()

    # Colori default ciclici per le ROI (BGR per OpenCV)
    default_colors = [
        [0, 255, 0],    # Verde
        [255, 255, 0],  # Ciano
        [0, 255, 255],  # Giallo
        [255, 0, 0],    # Blu
        [0, 0, 255],    # Rosso
        [255, 0, 255],  # Magenta
        [128, 255, 0],  # Verde chiaro
        [255, 128, 0],  # Azzurro
    ]

    # Costruisci il formato rois.json
    rois_json = {
        "_comment": f"ROI esportate dal frontend per camera {camera_id}.",
        "rois": [],
    }

    for i, roi in enumerate(rois):
        roi_entry = {
            "id": f"ROI_{roi.id}",
            "name": roi.name,
            "aisle_id": roi.aisle_id,
            "camera_id": roi.camera_id,
            "points": roi.points,
            "reference_point": "bottom_center",
            "parent_id": None,
            "color": default_colors[i % len(default_colors)],
            "is_active": roi.is_active,
            "dwell_threshold_sec": 5.0,
        }
        rois_json["rois"].append(roi_entry)

    # Scrivi il file rois.json
    # Il path è relativo al volume Docker condiviso
    rois_file_path = Path(os.getenv("ROI_EXPORT_PATH", "/app/../video_analyzer/data/rois.json"))
    # In sviluppo locale: il backend e video_analyzer condividono la stessa root
    if not rois_file_path.is_absolute():
        rois_file_path = Path(__file__).resolve().parent.parent.parent.parent / "video_analyzer" / "data" / "rois.json"

    try:
        rois_file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(rois_file_path, "w", encoding="utf-8") as f:
            json.dump(rois_json, f, indent=4, ensure_ascii=False)
        logger.info(f"File rois.json scritto: {rois_file_path} ({len(rois)} ROI)")
    except Exception as e:
        logger.error(f"Errore scrittura rois.json: {e}")
        raise HTTPException(status_code=500, detail=f"Errore scrittura file ROI: {e}")

    # Invia segnale MQTT di reload
    mqtt_sent = _send_mqtt_reload_signal(camera_id)

    return {
        "exported": len(rois),
        "file": str(rois_file_path),
        "mqtt_signal_sent": mqtt_sent,
    }


def _send_mqtt_reload_signal(camera_id: str) -> bool:
    """Pubblica un messaggio MQTT per segnalare al video analyzer di ricaricare le ROI."""
    broker = os.getenv("MQTT_BROKER", "localhost")
    port = int(os.getenv("MQTT_PORT", "1883"))
    topic = "logistics/control/reload_rois"

    try:
        client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id="backend_roi_export",
            protocol=mqtt.MQTTv5,
        )
        client.connect(broker, port, keepalive=10)
        payload = json.dumps({"camera_id": camera_id, "action": "reload"})
        result = client.publish(topic, payload, qos=1)
        client.disconnect()

        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            logger.info(f"Segnale MQTT reload ROI inviato per camera {camera_id}")
            return True
        else:
            logger.warning(f"Errore invio segnale MQTT: rc={result.rc}")
            return False
    except Exception as e:
        logger.warning(f"MQTT non disponibile per segnale reload: {e}")
        return False
