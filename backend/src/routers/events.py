"""
LogisticsTrack — Events Router
API REST per query e gestione eventi di videoanalisi.
Include endpoint SSE per aggiornamenti real-time.
"""

import asyncio
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_session
from db.models import Event
from models.schemas import EventListResponse, EventResponse

# Directory dei crop (condivisa con video_analyzer)
CROPS_DIR = Path(os.getenv("CROPS_DIR", str(Path(__file__).resolve().parent.parent.parent.parent / "video_analyzer" / "data" / "crops")))

logger = logging.getLogger("EventsRouter")

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("/stream")
async def stream_events(request: Request):
    """
    Server-Sent Events: invia un messaggio JSON per ogni nuovo evento
    MQTT ricevuto e persistito.

    Il client si connette e rimane in ascolto. Il server invia:
    - `data: {...}\\n\\n` per ogni nuovo evento
    - `: keepalive\\n\\n` ogni 30s se non ci sono eventi (evita timeout proxy)

    Il client si disconnette chiudendo la connessione HTTP.
    """
    listener = getattr(request.app.state, "mqtt_listener", None)
    if listener is None:
        # Fallback: stream vuoto (solo keepalive) se il listener non è disponibile
        async def _empty_stream():
            while True:
                if await request.is_disconnected():
                    break
                yield ": keepalive\n\n"
                await asyncio.sleep(30)
        return StreamingResponse(
            _empty_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    queue = listener.subscribe_sse()

    async def generator():
        try:
            while True:
                # Controlla disconnessione prima di attendere
                if await request.is_disconnected():
                    break
                try:
                    # Attendi il prossimo evento con timeout keepalive
                    event_data = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps(event_data)}\n\n"
                except asyncio.TimeoutError:
                    # Keepalive: previene timeout lato proxy/browser
                    yield ": keepalive\n\n"
        finally:
            listener.unsubscribe_sse(queue)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _apply_rbac_filter(query, user_role: str = "admin", camera_ids: Optional[list[str]] = None):
    """
    Predisposizione RBAC: filtro accesso eventi per ruolo e camera.

    Attualmente no-op (single-user admin). Fase 11 implementerà:
      - user_role == "viewer":    filtra per camera_ids accessibili
      - user_role == "operator":  filtra per module_type accessibili
    Il parametro camera_ids è riservato per la Fase 11.

    TODO Fase 11:
        if user_role == "viewer" and camera_ids:
            query = query.where(Event.camera_id.in_(camera_ids))
        if user_role == "module_operator" and module_types:
            query = query.where(Event.module_type.in_(module_types))
    """
    return query  # ora: nessun filtro (single-user admin)


@router.get("", response_model=EventListResponse)
async def list_events(
    camera_id: Optional[str] = Query(None, description="Filtra per camera"),
    aisle_id: Optional[str] = Query(None, description="Filtra per corsia"),
    event_type: Optional[str] = Query(None, description="Filtra per tipo evento"),
    module_type: Optional[str] = Query(None, description="Filtra per modulo (logistics, no_entry_filter)"),
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
    Supporta filtro per module_type (schema v2.0).
    """
    # Query base
    query = select(Event)
    count_query = select(func.count(Event.id))

    # Applica filtri (ILIKE per match parziale sui campi testo)
    if camera_id:
        query = query.where(Event.camera_id.ilike(f"%{camera_id}%"))
        count_query = count_query.where(Event.camera_id.ilike(f"%{camera_id}%"))
    if aisle_id:
        query = query.where(Event.aisle_id.ilike(f"%{aisle_id}%"))
        count_query = count_query.where(Event.aisle_id.ilike(f"%{aisle_id}%"))
    if event_type:
        query = query.where(Event.event_type.ilike(f"%{event_type}%"))
        count_query = count_query.where(Event.event_type.ilike(f"%{event_type}%"))
    if module_type:
        # Match esatto (es. "logistics", "no_entry_filter")
        query = query.where(Event.module_type == module_type)
        count_query = count_query.where(Event.module_type == module_type)
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

    # Filtro RBAC (predisposizione Fase 11 — ora no-op)
    query = _apply_rbac_filter(query)
    count_query = _apply_rbac_filter(count_query)

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


@router.get("/{event_id}", response_model=EventResponse)
async def get_event(
    event_id: int,
    session: AsyncSession = Depends(get_session),
) -> EventResponse:
    """Dettaglio singolo evento per ID."""
    result = await session.execute(select(Event).where(Event.id == event_id))
    event = result.scalar_one_or_none()

    if event is None:
        raise HTTPException(status_code=404, detail=f"Evento {event_id} non trovato")

    return EventResponse.model_validate(event)


@router.get("/{event_id}/crop")
async def get_event_crop(
    event_id: int,
    session: AsyncSession = Depends(get_session),
):
    """
    Restituisce l'immagine crop (JPEG) del target rilevato per un evento.

    Il crop viene salvato dal video analyzer al momento della detection.
    """
    result = await session.execute(select(Event).where(Event.id == event_id))
    event = result.scalar_one_or_none()

    if event is None:
        raise HTTPException(status_code=404, detail=f"Evento {event_id} non trovato")

    # Estrai crop_filename da event_data (schema v2.0, ex raw_data)
    event_data = event.event_data or {}
    crop_filename = event_data.get("crop_filename", "")

    if not crop_filename:
        raise HTTPException(status_code=404, detail="Nessun crop disponibile per questo evento")

    # Sicurezza: previeni path traversal
    crop_path = (CROPS_DIR / crop_filename).resolve()
    if not str(crop_path).startswith(str(CROPS_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Path non valido")

    if not crop_path.exists():
        raise HTTPException(status_code=404, detail="File crop non trovato")

    return FileResponse(
        path=str(crop_path),
        media_type="image/jpeg",
        filename=crop_path.name,
    )
