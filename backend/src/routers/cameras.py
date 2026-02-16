"""
LogisticsTrack — Cameras Router
API REST per gestione camere.
"""

import logging

import cv2
import numpy as np
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
            cap = cv2.VideoCapture(camera.rtsp_url)
            cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
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
