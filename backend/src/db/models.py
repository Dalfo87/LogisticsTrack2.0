"""
LogisticsTrack — SQLAlchemy ORM Models
Mappano le tabelle definite in init.sql.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from db.database import Base


class Camera(Base):
    """Tabella camere registrate."""
    __tablename__ = "cameras"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    rtsp_url: Mapped[str | None] = mapped_column(String(500))
    location: Mapped[str | None] = mapped_column(String(200))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relazioni
    rois: Mapped[list["ROI"]] = relationship(back_populates="camera", cascade="all, delete-orphan")
    events: Mapped[list["Event"]] = relationship(back_populates="camera")


class ROI(Base):
    """Tabella ROI (Region of Interest) per camera."""
    __tablename__ = "rois"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    camera_id: Mapped[str] = mapped_column(String(50), ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    aisle_id: Mapped[str] = mapped_column(String(50), nullable=False)
    points: Mapped[dict] = mapped_column(JSONB, nullable=False)  # Array di {x, y}
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relazioni
    camera: Mapped["Camera"] = relationship(back_populates="rois")


class Event(Base):
    """Tabella eventi rilevati dalla videoanalisi."""
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    camera_id: Mapped[str] = mapped_column(String(50), ForeignKey("cameras.id"), nullable=False)
    aisle_id: Mapped[str | None] = mapped_column(String(50))
    event_type: Mapped[str] = mapped_column(String(50), nullable=False, default="forklift_pallet")

    # Dati grezzi AI
    raw_data: Mapped[dict | None] = mapped_column(JSONB)

    # Tracking
    track_id: Mapped[int | None] = mapped_column(Integer)
    entered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    exited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Integrazione WMS
    external_tag: Mapped[str | None] = mapped_column(String(200))
    matched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    validated: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relazioni
    camera: Mapped["Camera"] = relationship(back_populates="events")


class WMSTag(Base):
    """Tabella tag WMS esterni per matching con eventi."""
    __tablename__ = "wms_tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    tag_data: Mapped[str] = mapped_column(String(500), nullable=False)
    aisle_id: Mapped[str | None] = mapped_column(String(50))
    matched_event_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("events.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
