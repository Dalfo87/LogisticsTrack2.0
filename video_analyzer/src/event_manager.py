"""
LogisticsTrack — Event Manager
Pubblica gli eventi ROI su MQTT broker (Mosquitto).

Responsabilità:
- Converte ROIEvent in payload JSON strutturato
- Pubblica su MQTT con QoS 1 (at least once)
- Gestisce connessione/riconnessione al broker
- Schema JSON versionato per compatibilità futura

Il backend FastAPI sottoscrive lo stesso topic MQTT e persiste gli eventi su PostgreSQL.
"""

import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional

import paho.mqtt.client as mqtt

from config import VideoAnalyzerConfig
from roi_engine import ROIEvent

logger = logging.getLogger("EventManager")

# Versione schema payload — incrementare se cambia la struttura
PAYLOAD_SCHEMA_VERSION = "1.0"


class EventManager:
    """
    Gestisce la pubblicazione di eventi ROI su MQTT.

    Ciclo di vita:
    1. connect() — connessione al broker
    2. publish_event() — chiamato dal main loop per ogni ROIEvent
    3. disconnect() — chiusura pulita
    """

    def __init__(self, config: VideoAnalyzerConfig) -> None:
        self.config = config
        self._client: Optional[mqtt.Client] = None
        self._connected: bool = False
        self._event_count: int = 0

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
        else:
            self._connected = False
            logger.error(f"MQTT: connessione rifiutata, codice={reason_code}")

    def _on_disconnect(self, client, userdata, flags, reason_code, properties=None) -> None:
        self._connected = False
        if reason_code != 0:
            logger.warning(f"MQTT: disconnessione inattesa, codice={reason_code}. Riconnessione automatica...")

    def _on_publish(self, client, userdata, mid, reason_codes=None, properties=None) -> None:
        logger.debug(f"MQTT: messaggio {mid} pubblicato con successo.")

    # -------------------------------------------------------------------
    # Pubblicazione eventi
    # -------------------------------------------------------------------

    def publish_event(self, event: ROIEvent) -> bool:
        """
        Pubblica un singolo ROIEvent su MQTT.

        Args:
            event: Evento da pubblicare.

        Returns:
            True se pubblicato con successo, False altrimenti.
        """
        if not self._client or not self._connected:
            logger.warning(f"MQTT non connesso. Evento perso: {event.event_type} track={event.track_id}")
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
                    f"Evento pubblicato: {event.event_type} "
                    f"track={event.track_id} roi={event.roi_id}"
                )
                return True
            else:
                logger.error(f"Errore pubblicazione MQTT: rc={result.rc}")
                return False

        except Exception as e:
            logger.error(f"Errore pubblicazione MQTT: {e}")
            return False

    def publish_events(self, events: list[ROIEvent]) -> int:
        """
        Pubblica una lista di eventi.

        Args:
            events: Lista di ROIEvent da pubblicare.

        Returns:
            Numero di eventi pubblicati con successo.
        """
        published = 0
        for event in events:
            if self.publish_event(event):
                published += 1
        return published

    # -------------------------------------------------------------------
    # Serializzazione
    # -------------------------------------------------------------------

    @staticmethod
    def _event_to_payload(event: ROIEvent) -> dict:
        """
        Converte un ROIEvent in payload JSON per MQTT.

        Schema versionato per garantire compatibilità con il backend.
        """
        return {
            "schema_version": PAYLOAD_SCHEMA_VERSION,
            "timestamp": datetime.fromtimestamp(event.timestamp, tz=timezone.utc).isoformat(),
            "event_type": event.event_type,
            "camera_id": event.camera_id,
            "roi_id": event.roi_id,
            "roi_name": event.roi_name,
            "aisle_id": event.aisle_id,
            "track_id": event.track_id,
            "confidence": round(event.confidence, 3),
            "bbox": list(event.bbox),
            "reference_point": event.reference_point_used,
            "dwell_seconds": round(event.dwell_seconds, 2),
            "parent_roi_id": event.parent_roi_id,
        }
