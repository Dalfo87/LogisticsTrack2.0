"""
LogisticsTrack — Pydantic Schemas
Modelli per validazione request/response delle API REST.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Camera
# ---------------------------------------------------------------------------

class CameraBase(BaseModel):
    id: str = Field(..., max_length=50, examples=["CAM_DEV_01"])
    name: str = Field(..., max_length=100, examples=["Camera Magazzino Nord"])
    rtsp_url: Optional[str] = Field(None, max_length=500)
    location: Optional[str] = Field(None, max_length=200)
    is_active: bool = True


class CameraCreate(CameraBase):
    pass


class CameraResponse(CameraBase):
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# ROI
# ---------------------------------------------------------------------------

class ROIBase(BaseModel):
    camera_id: str = Field(..., max_length=50)
    name: str = Field(..., max_length=100, examples=["Corsia A-01"])
    aisle_id: str = Field(..., max_length=50, examples=["A-01"])
    points: list[list[float]] = Field(..., examples=[[[100, 200], [400, 200], [400, 600], [100, 600]]])
    is_active: bool = True


class ROICreate(ROIBase):
    pass


class ROIResponse(ROIBase):
    id: int
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Event
# ---------------------------------------------------------------------------

class EventBase(BaseModel):
    timestamp: datetime
    camera_id: str
    aisle_id: Optional[str] = None
    event_type: str = "forklift_pallet"
    raw_data: Optional[dict] = None
    track_id: Optional[int] = None
    entered_at: Optional[datetime] = None
    exited_at: Optional[datetime] = None


class EventResponse(EventBase):
    id: int
    external_tag: Optional[str] = None
    matched_at: Optional[datetime] = None
    validated: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class EventListResponse(BaseModel):
    """Risposta paginata per lista eventi."""
    events: list[EventResponse]
    total: int
    page: int
    page_size: int


# ---------------------------------------------------------------------------
# WMS Tag
# ---------------------------------------------------------------------------

class WMSTagCreate(BaseModel):
    tag_data: str = Field(..., max_length=500, examples=["PALLET-2026-001234"])
    aisle_id: Optional[str] = Field(None, max_length=50)


class WMSTagResponse(BaseModel):
    id: int
    timestamp: datetime
    tag_data: str
    aisle_id: Optional[str]
    matched_event_id: Optional[int]
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# MQTT Event Payload (da video analyzer)
# ---------------------------------------------------------------------------

class MQTTEventPayload(BaseModel):
    """Schema del payload MQTT pubblicato dal video analyzer."""
    schema_version: str = "1.0"
    timestamp: datetime
    event_type: str
    camera_id: str
    roi_id: str
    roi_name: str
    aisle_id: str
    track_id: int
    confidence: float
    bbox: list[int]
    reference_point: str
    dwell_seconds: float = 0.0
    parent_roi_id: Optional[str] = None
