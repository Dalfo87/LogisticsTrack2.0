"""
LogisticsTrack — MQTT Listener Service
Sottoscrive il topic MQTT degli eventi del video analyzer,
parsa il payload JSON e persiste gli eventi su PostgreSQL.

Si avvia come task in background insieme a FastAPI.
"""

import asyncio
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

import paho.mqtt.client as mqtt
from dotenv import load_dotenv
from sqlalchemy import insert

from db.database import async_session
from db.models import Event

# Carica .env
_env_path = Path(__file__).resolve().parent.parent.parent.parent / ".env"
load_dotenv(_env_path)

logger = logging.getLogger("MQTTListener")


class MQTTListener:
    """
    Servizio che ascolta eventi MQTT dal video analyzer
    e li persiste su PostgreSQL.
    """

    def __init__(self) -> None:
        self._broker = os.getenv("MQTT_BROKER", "localhost")
        self._port = int(os.getenv("MQTT_PORT", "1883"))
        self._topic = os.getenv("MQTT_TOPIC_EVENTS", "logistics/events")
        self._client: Optional[mqtt.Client] = None
        self._connected = False
        self._event_queue: asyncio.Queue = asyncio.Queue()
        self._persist_task: Optional[asyncio.Task] = None
        self._running = False
        self._events_persisted = 0

    # -------------------------------------------------------------------
    # Lifecycle
    # -------------------------------------------------------------------

    async def start(self) -> None:
        """Avvia il listener MQTT e il task di persistenza."""
        self._running = True

        # Avvia il task di persistenza asincrono
        self._persist_task = asyncio.create_task(self._persist_loop())

        # Connetti al broker MQTT
        try:
            self._client = mqtt.Client(
                callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                client_id="backend_listener",
                protocol=mqtt.MQTTv5,
            )
            self._client.on_connect = self._on_connect
            self._client.on_disconnect = self._on_disconnect
            self._client.on_message = self._on_message

            self._client.connect(self._broker, self._port, keepalive=60)
            self._client.loop_start()

            logger.info(f"MQTT Listener avviato — broker={self._broker}:{self._port} topic={self._topic}")

        except Exception as e:
            logger.error(f"Errore avvio MQTT Listener: {e}")

    async def stop(self) -> None:
        """Ferma il listener e il task di persistenza."""
        self._running = False

        if self._client:
            self._client.loop_stop()
            self._client.disconnect()

        if self._persist_task:
            self._persist_task.cancel()
            try:
                await self._persist_task
            except asyncio.CancelledError:
                pass

        logger.info(f"MQTT Listener fermato. Totale eventi persistiti: {self._events_persisted}")

    # -------------------------------------------------------------------
    # Callbacks MQTT (eseguiti nel thread paho)
    # -------------------------------------------------------------------

    def _on_connect(self, client, userdata, flags, reason_code, properties=None) -> None:
        if reason_code == 0:
            self._connected = True
            client.subscribe(self._topic, qos=1)
            logger.info(f"MQTT: connesso e sottoscritto a '{self._topic}'")
        else:
            self._connected = False
            logger.error(f"MQTT: connessione rifiutata, codice={reason_code}")

    def _on_disconnect(self, client, userdata, flags, reason_code, properties=None) -> None:
        self._connected = False
        if reason_code != 0:
            logger.warning(f"MQTT: disconnessione inattesa, codice={reason_code}")

    def _on_message(self, client, userdata, msg) -> None:
        """Riceve messaggio MQTT e lo mette in coda per la persistenza async."""
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
            # Metti in coda (thread-safe grazie a asyncio.Queue con call_soon_threadsafe)
            loop = asyncio.get_event_loop()
            loop.call_soon_threadsafe(self._event_queue.put_nowait, payload)
            logger.debug(f"Evento ricevuto: {payload.get('event_type')} track={payload.get('track_id')}")
        except json.JSONDecodeError as e:
            logger.error(f"Payload MQTT non valido: {e}")
        except Exception as e:
            logger.error(f"Errore processamento messaggio MQTT: {e}")

    # -------------------------------------------------------------------
    # Persistenza asincrona
    # -------------------------------------------------------------------

    async def _persist_loop(self) -> None:
        """Loop che preleva eventi dalla coda e li persiste su DB."""
        logger.info("Task di persistenza avviato.")

        while self._running:
            try:
                # Attendi evento con timeout (permette check _running)
                try:
                    payload = await asyncio.wait_for(self._event_queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                await self._persist_event(payload)

            except asyncio.CancelledError:
                # Svuota la coda prima di uscire
                while not self._event_queue.empty():
                    try:
                        payload = self._event_queue.get_nowait()
                        await self._persist_event(payload)
                    except asyncio.QueueEmpty:
                        break
                raise

            except Exception as e:
                logger.error(f"Errore nel loop di persistenza: {e}", exc_info=True)
                await asyncio.sleep(1.0)

    async def _persist_event(self, payload: dict) -> None:
        """Persiste un singolo evento MQTT su PostgreSQL."""
        try:
            event_type = payload.get("event_type", "unknown")
            timestamp_str = payload.get("timestamp")
            camera_id = payload.get("camera_id", "unknown")
            aisle_id = payload.get("aisle_id")
            track_id = payload.get("track_id")
            dwell_seconds = payload.get("dwell_seconds", 0.0)

            # Parse timestamp ISO 8601
            timestamp = datetime.fromisoformat(timestamp_str) if timestamp_str else datetime.utcnow()

            # Costruisci raw_data con tutti i dati del payload
            raw_data = {
                "schema_version": payload.get("schema_version"),
                "roi_id": payload.get("roi_id"),
                "roi_name": payload.get("roi_name"),
                "confidence": payload.get("confidence"),
                "bbox": payload.get("bbox"),
                "reference_point": payload.get("reference_point"),
                "dwell_seconds": dwell_seconds,
                "parent_roi_id": payload.get("parent_roi_id"),
            }

            # Determina entered_at/exited_at in base al tipo evento
            entered_at = None
            exited_at = None
            if event_type == "roi_enter":
                entered_at = timestamp
            elif event_type == "roi_exit":
                exited_at = timestamp

            async with async_session() as session:
                stmt = insert(Event).values(
                    timestamp=timestamp,
                    camera_id=camera_id,
                    aisle_id=aisle_id,
                    event_type=event_type,
                    raw_data=raw_data,
                    track_id=track_id,
                    entered_at=entered_at,
                    exited_at=exited_at,
                )
                await session.execute(stmt)
                await session.commit()

            self._events_persisted += 1
            logger.info(
                f"Evento persistito: {event_type} | "
                f"track={track_id} | camera={camera_id} | "
                f"aisle={aisle_id} | dwell={dwell_seconds:.1f}s "
                f"[totale: {self._events_persisted}]"
            )

        except Exception as e:
            logger.error(f"Errore persistenza evento: {e}", exc_info=True)
