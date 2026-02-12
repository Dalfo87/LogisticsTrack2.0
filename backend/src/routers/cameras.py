"""
LogisticsTrack — Cameras Router
API REST per gestione camere.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
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
