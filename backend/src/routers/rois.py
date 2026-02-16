"""
LogisticsTrack — ROIs Router
API REST per gestione ROI (Region of Interest).
CRUD completo + endpoint per ottenere snapshot da camera per l'editor.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_session
from db.models import ROI, Camera
from models.schemas import ROICreate, ROIResponse

logger = logging.getLogger("ROIsRouter")

router = APIRouter(prefix="/api/rois", tags=["rois"])


@router.get("", response_model=list[ROIResponse])
async def list_rois(
    camera_id: str = None,
    session: AsyncSession = Depends(get_session),
) -> list[ROIResponse]:
    """Lista ROI, opzionalmente filtrate per camera."""
    query = select(ROI).order_by(ROI.name)
    if camera_id:
        query = query.where(ROI.camera_id == camera_id)

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
    cam = await session.execute(select(Camera).where(Camera.id == data.camera_id))
    if cam.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"Camera '{data.camera_id}' non trovata")

    # Validazione minima: almeno 3 punti per un poligono
    if len(data.points) < 3:
        raise HTTPException(status_code=422, detail="Servono almeno 3 punti per definire una ROI")

    roi = ROI(**data.model_dump())
    session.add(roi)
    await session.commit()
    await session.refresh(roi)

    logger.info(f"ROI creata: {roi.id} — {roi.name} (camera={roi.camera_id})")
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

    if len(data.points) < 3:
        raise HTTPException(status_code=422, detail="Servono almeno 3 punti per definire una ROI")

    roi.camera_id = data.camera_id
    roi.name = data.name
    roi.aisle_id = data.aisle_id
    roi.points = data.points
    roi.is_active = data.is_active

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
