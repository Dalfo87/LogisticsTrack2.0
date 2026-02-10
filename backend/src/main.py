"""
LogisticsTrack — Backend API
Entry point FastAPI. Implementazione completa in Fase 3.
"""

import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("Backend")

app = FastAPI(
    title="LogisticsTrack API",
    description="API per il sistema di videosorveglianza forense logistica",
    version="0.1.0",
)

# CORS per frontend dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173",
                   "http://192.168.0.120:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check() -> dict:
    """Endpoint di controllo stato servizio."""
    return {"status": "ok", "service": "LogisticsTrack Backend"}
