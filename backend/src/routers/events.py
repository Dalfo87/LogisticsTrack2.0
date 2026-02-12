"""
LogisticsTrack — Events Router
API REST per query e gestione eventi di videoanalisi.
"""

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_session
from db.models import Event
from models.schemas import EventListResponse, EventResponse

logger = logging.getLogger("EventsRouter")

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("", response_model=EventListResponse)
async def list_events(
    camera_id: Optional[str] = Query(None, description="Filtra per camera"),
    aisle_id: Optional[str] = Query(None, description="Filtra per corsia"),
    event_type: Optional[str] = Query(None, description="Filtra per tipo evento"),
    track_id: Optional[int] = Query(None, description="Filtra per track ID"),
    validated: Optional[bool] = Query(None, description="Filtra per stato validazione"),
    date_from: Optional[datetime] = Query(None, description="Data inizio (ISO 8601)"),
    date_to: Optional[datetime] = Query(None, description="Data fine (ISO 8601)"),
    page: int = Query(1, ge=1, description="Numero pagina"),
    page_size: int = Query(50, ge=1, le=200, description="Elementi per pagina"),
    session: AsyncSession = Depends(get_session),
) -> EventListResponse:
    """
    Lista eventi con filtri e paginazione.

    Ordinati per timestamp decrescente (più recenti prima).
    """
    # Query base
    query = select(Event)
    count_query = select(func.count(Event.id))

    # Applica filtri
    if camera_id:
        query = query.where(Event.camera_id == camera_id)
        count_query = count_query.where(Event.camera_id == camera_id)
    if aisle_id:
        query = query.where(Event.aisle_id == aisle_id)
        count_query = count_query.where(Event.aisle_id == aisle_id)
    if event_type:
        query = query.where(Event.event_type == event_type)
        count_query = count_query.where(Event.event_type == event_type)
    if track_id is not None:
        query = query.where(Event.track_id == track_id)
        count_query = count_query.where(Event.track_id == track_id)
    if validated is not None:
        query = query.where(Event.validated == validated)
        count_query = count_query.where(Event.validated == validated)
    if date_from:
        query = query.where(Event.timestamp >= date_from)
        count_query = count_query.where(Event.timestamp >= date_from)
    if date_to:
        query = query.where(Event.timestamp <= date_to)
        count_query = count_query.where(Event.timestamp <= date_to)

    # Conteggio totale
    total_result = await session.execute(count_query)
    total = total_result.scalar() or 0

    # Paginazione + ordinamento
    offset = (page - 1) * page_size
    query = query.order_by(desc(Event.timestamp)).offset(offset).limit(page_size)

    result = await session.execute(query)
    events = result.scalars().all()

    return EventListResponse(
        events=[EventResponse.model_validate(e) for e in events],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{event_id}", response_model=EventResponse)
async def get_event(
    event_id: int,
    session: AsyncSession = Depends(get_session),
) -> EventResponse:
    """Dettaglio singolo evento per ID."""
    from fastapi import HTTPException

    result = await session.execute(select(Event).where(Event.id == event_id))
    event = result.scalar_one_or_none()

    if event is None:
        raise HTTPException(status_code=404, detail=f"Evento {event_id} non trovato")

    return EventResponse.model_validate(event)


@router.get("/stats/summary")
async def events_summary(
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Statistiche riassuntive degli eventi."""
    # Totale eventi
    total_result = await session.execute(select(func.count(Event.id)))
    total = total_result.scalar() or 0

    # Per tipo
    type_query = (
        select(Event.event_type, func.count(Event.id))
        .group_by(Event.event_type)
    )
    type_result = await session.execute(type_query)
    by_type = {row[0]: row[1] for row in type_result.all()}

    # Per camera
    camera_query = (
        select(Event.camera_id, func.count(Event.id))
        .group_by(Event.camera_id)
    )
    camera_result = await session.execute(camera_query)
    by_camera = {row[0]: row[1] for row in camera_result.all()}

    # Validati vs non validati
    validated_result = await session.execute(
        select(func.count(Event.id)).where(Event.validated == True)
    )
    validated_count = validated_result.scalar() or 0

    return {
        "total_events": total,
        "validated": validated_count,
        "unvalidated": total - validated_count,
        "by_type": by_type,
        "by_camera": by_camera,
    }
