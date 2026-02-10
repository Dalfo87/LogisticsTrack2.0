"""
LogisticsTrack — Video Analyzer Configuration
Configurazione centralizzata. Legge da variabili ambiente o usa defaults.
"""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Cerca il .env nella root del progetto (due livelli su da src/)
_env_path = Path(__file__).resolve().parent.parent.parent / ".env"
load_dotenv(_env_path)

@dataclass
class VideoAnalyzerConfig:
    """Configurazione completa del Video Analyzer."""

    # Sorgente video: path file MP4 o URL RTSP
    video_source: str = os.getenv("VIDEO_SOURCE","data/videos/Videotest1.mp4")

    # Modello YOLO
    yolo_model: str = os.getenv("YOLO_MODEL", "yolov8n.pt")
    yolo_confidence: float = float(os.getenv("YOLO_CONFIDENCE", "0.4"))
    yolo_device: str = os.getenv("YOLO_DEVICE", "0")  # "0" = GPU, "cpu" = CPU

    # Tracking
    tracker_type: str = os.getenv("TRACKER_TYPE", "bytetrack.yaml")

    # Classi da rilevare (indici COCO dataset)
    # Per prototipo: person=0, bicycle=1, car=2, truck=7
    # In produzione con modello custom: forklift, pallet, forklift_with_pallet
    target_classes: list[int] | None = None

    # Video processing
    frame_width: int = int(os.getenv("FRAME_WIDTH", "1280"))
    frame_height: int = int(os.getenv("FRAME_HEIGHT", "720"))
    show_display: bool = os.getenv("SHOW_DISPLAY", "true").lower() == "true"

    # MQTT (usato in Fase 2)
    mqtt_broker: str = os.getenv("MQTT_BROKER", "localhost")
    mqtt_port: int = int(os.getenv("MQTT_PORT", "1883"))
    mqtt_topic: str = os.getenv("MQTT_TOPIC_EVENTS", "logistics/events")

    # RTSP reconnection
    rtsp_reconnect_delay: int = int(os.getenv("RTSP_RECONNECT_DELAY", "5"))

    def __post_init__(self) -> None:
        """Parsing target_classes da env se presente."""
        classes_env = os.getenv("TARGET_CLASSES", "")
        if classes_env:
            self.target_classes = [int(c.strip()) for c in classes_env.split(",")]

    @property
    def is_rtsp(self) -> bool:
        """True se la sorgente è uno stream RTSP."""
        return self.video_source.lower().startswith("rtsp://")

    @property
    def is_file(self) -> bool:
        """True se la sorgente è un file locale."""
        return not self.is_rtsp
