"""
LogisticsTrack — Database Connection
Connessione async a PostgreSQL con SQLAlchemy 2.0 + asyncpg.
"""

import os
import logging
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

# Carica .env dalla root del progetto
_env_path = Path(__file__).resolve().parent.parent.parent.parent / ".env"
load_dotenv(_env_path)

logger = logging.getLogger("Database")

# URL di connessione
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://admin:secure_password_2026@localhost:5432/logistics_track"
)

# Engine async
engine = create_async_engine(
    DATABASE_URL,
    echo=False,           # True per debug SQL
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,   # Verifica connessione prima di usarla
)

# Session factory
async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


# Base per modelli ORM
class Base(DeclarativeBase):
    pass


async def get_session() -> AsyncSession:
    """Dependency FastAPI per ottenere una sessione DB."""
    async with async_session() as session:
        yield session


async def apply_migrations() -> None:
    """Applica migrazioni idempotenti v1.0 → v2.0 allo schema DB.

    Sicuro da eseguire ad ogni avvio: tutte le istruzioni usano
    IF NOT EXISTS / DO $$ IF EXISTS $$, quindi non modificano nulla
    se lo schema è già aggiornato.
    """
    migrations = [
        # 1. Aggiunge modules_config a cameras
        "ALTER TABLE cameras ADD COLUMN IF NOT EXISTS modules_config JSONB DEFAULT '{}'",
        # 2. Aggiunge module_type a rois
        "ALTER TABLE rois ADD COLUMN IF NOT EXISTS module_type VARCHAR(50) NOT NULL DEFAULT 'logistics'",
        # 3. Aggiunge module_type a events
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS module_type VARCHAR(50) NOT NULL DEFAULT 'logistics'",
        # 4. Rinomina raw_data → event_data (solo se raw_data esiste ancora)
        """DO $$ BEGIN
               IF EXISTS (
                   SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'events' AND column_name = 'raw_data'
               ) THEN
                   ALTER TABLE events RENAME COLUMN raw_data TO event_data;
               END IF;
           END $$""",
        # 5. Indici aggiuntivi (idempotenti)
        "CREATE INDEX IF NOT EXISTS idx_events_module_type ON events(module_type)",
        "CREATE INDEX IF NOT EXISTS idx_rois_module_type ON rois(module_type)",
    ]
    try:
        async with engine.begin() as conn:
            for sql in migrations:
                await conn.execute(text(sql))
        logger.info("Migrazioni DB applicate (idempotenti).")
    except Exception as e:
        logger.error(f"Errore durante le migrazioni DB: {e}")
        raise


async def init_db() -> None:
    """Verifica connessione al database e applica migrazioni v2.0."""
    try:
        async with engine.begin() as conn:
            # Verifica che la connessione funzioni
            await conn.run_sync(lambda c: None)
        logger.info(f"Database connesso: {DATABASE_URL.split('@')[-1]}")
        await apply_migrations()
    except Exception as e:
        logger.error(f"Errore connessione database: {e}")
        raise


async def close_db() -> None:
    """Chiude il pool di connessioni."""
    await engine.dispose()
    logger.info("Pool connessioni database chiuso.")
