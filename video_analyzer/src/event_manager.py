"""
LogisticsTrack — Event Manager
Pubblica gli eventi su MQTT broker (Mosquitto).

Responsabilità:
- Converte BaseEvent in payload JSON strutturato (schema v2.0)
- Pubblica su MQTT con QoS 1 (at least once)
- Gestisce connessione/riconnessione al broker
- Schema JSON versionato per compatibilità con il backend

Il backend FastAPI sottoscrive lo stesso topic MQTT e persiste gli eventi su PostgreSQL.
Il backend supporta sia schema v1.0 (legacy) che v2.0 (multi-modulo).
"""

import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional

import paho.mqtt.client as mqtt

from config import VideoAnalyzerConfig
from modules.base import BaseEvent

logger = logging.getLogger("EventManager")

# Versione schema payload v2.0: supporta multi-modulo con event_data strutturato
PAYLOAD_SCHEMA_VERSION = "2.0"


class EventManager:
    """
    Gestisce la pubblicazione di eventi su MQTT.

    Ciclo di vita:
    1. connect() — connessione al broker
    2. publish_event() — chiamato dal main loop per ogni BaseEvent
    3. disconnect() — chiusura pulita

    Schema payload v2.0:
    {
        "schema_version": "2.0",
        "timestamp": "2026-02-24T12:34:56.789Z",  # ISO 8601 UTC
        "module_type": "logistics",                 # Modulo sorgente
        "event_type": "roi_enter",
        "camera_id": "CAM_DEV_01",
        "track_id": 5,
        "confidence": 0.95,
        "bbox": [100, 200, 400, 600],
        "crop_filename": "CAM_DEV_01/...",
        "event_data": { ... }                       # Dati specifici del modulo
    }
    """

    def __init__(self, config: VideoAnalyzerConfig) -> None:
        self.config = config
        self._client: Optional[mqtt.Client] = None
        self._connected: bool = False
        self._event_count: int = 0
        self._roi_reload_requested: bool = False
        self._control_topic: str = "logistics/control/reload_rois"

    # -------------------------------------------------------------------
    # Connessione MQTT
    # -------------------------------------------------------------------

    def connect(self) -> bool:
        """
        Connette al broker MQTT.

        Returns:
            True se la connessione ha successo, False altrimenti.
        """
        try:
            self._client = mqtt.Client(
                callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                client_id=f"video_analyzer_{self.config.camera_id}",
                protocol=mqtt.MQTTv5,
            )

            # Callbacks
            self._client.on_connect = self._on_connect
            self._client.on_disconnect = self._on_disconnect
            self._client.on_publish = self._on_publish
            self._client.on_message = self._on_message

            # Connessione (non bloccante con loop_start)
            logger.info(
                f"Connessione MQTT a {self.config.mqtt_broker}:{self.config.mqtt_port}..."
            )
            self._client.connect(
                self.config.mqtt_broker,
                self.config.mqtt_port,
                keepalive=60,
            )
            self._client.loop_start()

            # Attendi connessione (max 5 secondi)
            timeout = 5.0
            start = time.monotonic()
            while not self._connected and (time.monotonic() - start) < timeout:
                time.sleep(0.1)

            if self._connected:
                logger.info("Connessione MQTT stabilita.")
            else:
                logger.warning("Timeout connessione MQTT. Gli eventi verranno persi.")

            return self._connected

        except Exception as e:
            logger.error(f"Errore connessione MQTT: {e}")
            return False

    def disconnect(self) -> None:
        """Disconnessione pulita dal broker."""
        if self._client:
            self._client.loop_stop()
            self._client.disconnect()
            self._connected = False
            logger.info(f"MQTT disconnesso. Totale eventi pubblicati: {self._event_count}")

    @property
    def is_connected(self) -> bool:
        return self._connected

    # -------------------------------------------------------------------
    # Callbacks MQTT
    # -------------------------------------------------------------------

    def _on_connect(self, client, userdata, flags, reason_code, properties=None) -> None:
        if reason_code == 0:
            self._connected = True
            logger.info("MQTT: connesso al broker.")
            # Sottoscrivi al topic di controllo per hot-reload ROI
            client.subscribe(self._control_topic, qos=1)
            logger.info(f"MQTT: sottoscritto a {self._control_topic} per hot-reload ROI.")
        else:
            self._connected = False
            logger.error(f"MQTT: connessione rifiutata, codice={reason_code}")

    def _on_disconnect(self, client, userdata, flags, reason_code, properties=None) -> None:
        self._connected = False
        if reason_code != 0:
            logger.warning(
                f"MQTT: disconnessione inattesa, codice={reason_code}. "
                "Riconnessione automatica..."
            )

    def _on_publish(self, client, userdata, mid, reason_codes=None, properties=None) -> None:
        logger.debug(f"MQTT: messaggio {mid} pubblicato con successo.")

    def _on_message(self, client, userdata, message) -> None:
        """Callback per messaggi ricevuti (topic di controllo)."""
        if message.topic == self._control_topic:
            logger.info(f"MQTT: ricevuto segnale di reload ROI: {message.payload.decode()}")
            self._roi_reload_requested = True

    # -------------------------------------------------------------------
    # Hot-reload ROI
    # -------------------------------------------------------------------

    @property
    def roi_reload_requested(self) -> bool:
        """True se è stato ricevuto un segnale di reload ROI."""
        return self._roi_reload_requested

    def acknowledge_reload(self) -> None:
        """Conferma che il reload ROI è stato eseguito."""
        self._roi_reload_requested = False

    # -------------------------------------------------------------------
    # Pubblicazione eventi (BaseEvent — schema v2.0)
    # -------------------------------------------------------------------

    def publish_event(self, event: BaseEvent) -> bool:
        """
        Pubblica un singolo BaseEvent su MQTT (schema v2.0).

        Args:
            event: Evento da pubblicare.

        Returns:
            True se pubblicato con successo, False altrimenti.
        """
        if not self._client or not self._connected:
            logger.warning(
                f"MQTT non connesso. Evento perso: "
                f"{event.module_type}/{event.event_type} track={event.track_id}"
            )
            return False

        payload = self._event_to_payload(event)
        payload_json = json.dumps(payload, ensure_ascii=False)

        try:
            result = self._client.publish(
                topic=self.config.mqtt_topic,
                payload=payload_json,
                qos=1,  # At least once delivery
            )

            if result.rc == mqtt.MQTT_ERR_SUCCESS:
                self._event_count += 1
                logger.debug(
                    f"Evento pubblicato: {event.module_type}/{event.event_type} "
                    f"track={event.track_id}"
                )
                return True
            else:
                logger.error(f"Errore pubblicazione MQTT: rc={result.rc}")
                return False

        except Exception as e:
            logger.error(f"Errore pubblicazione MQTT: {e}")
            return False

    def publish_events(self, events: list[BaseEvent]) -> int:
        """
        Pubblica una lista di BaseEvent.

        Args:
            events: Lista di BaseEvent da pubblicare.

        Returns:
            Numero di eventi pubblicati con successo.
        """
        published = 0
        for event in events:
            if self.publish_event(event):
                published += 1
        return published

    # -------------------------------------------------------------------
    # Serializzazione — Schema v2.0
    # -------------------------------------------------------------------

    @staticmethod
    def _event_to_payload(event: BaseEvent) -> dict:
        """
        Converte un BaseEvent in payload JSON per MQTT (schema v2.0).

        Schema v2.0 — multi-modulo con event_data strutturato:
        - module_type: identifica il modulo sorgente
        - event_data: dati specifici del modulo (JSONB-compatibile)
        - Backward compat: il backend gestisce anche schema v1.0 (legacy)

        Converte esplicitamente tipi numpy in tipi Python nativi
        (YOLO restituisce numpy.int64/float64 non serializzabili da json.dumps).
        """
        return {
            "schema_version": PAYLOAD_SCHEMA_VERSION,
            "timestamp": datetime.fromtimestamp(event.timestamp, tz=timezone.utc).isoformat(),
            "module_type": str(event.module_type),
            "event_type": str(event.event_type),
            "camera_id": str(event.camera_id),
            "track_id": int(event.track_id),
            "confidence": float(round(event.confidence, 3)),
            "bbox": [int(x) for x in event.bbox],
            "crop_filename": str(event.crop_filename) if event.crop_filename else "",
            "event_data": event.event_data or {},
        }
