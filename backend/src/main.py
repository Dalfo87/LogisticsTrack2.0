"""
LogisticsTrack — Backend API
FastAPI entry point con lifecycle management.

Avvia:
- Connessione PostgreSQL (pool async)
- MQTT Listener (sottoscrizione eventi video analyzer)
- API REST (events, cameras)
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db.database import init_db, close_db
from routers import events, cameras
from services.mqtt_listener import MQTTListener

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("Backend")

# Istanza globale MQTT Listener
mqtt_listener = MQTTListener()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle FastAPI: startup e shutdown."""
    # --- STARTUP ---
    logger.info("=" * 60)
    logger.info("LogisticsTrack — Backend API")
    logger.info("=" * 60)

    # Database
    await init_db()

    # MQTT Listener
    await mqtt_listener.start()

    logger.info("Backend avviato.")
    logger.info("=" * 60)

    yield

    # --- SHUTDOWN ---
    logger.info("Shutdown in corso...")
    await mqtt_listener.stop()
    await close_db()
    logger.info("Backend terminato.")


app = FastAPI(
    title="LogisticsTrack API",
    description="API per il sistema di videosorveglianza forense logistica",
    version="0.2.0",
    lifespan=lifespan,
)

# CORS per frontend dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",    # Vite dev server
        "http://localhost:3000",    # Alternativa
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(events.router)
app.include_router(cameras.router)


@app.get("/health")
async def health_check() -> dict:
    """Endpoint di controllo stato servizio."""
    return {
        "status": "ok",
        "service": "LogisticsTrack Backend",
        "mqtt_connected": mqtt_listener._connected,
    }
