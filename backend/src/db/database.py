"""
LogisticsTrack — Database Connection
Connessione async a PostgreSQL con SQLAlchemy 2.0 + asyncpg.
"""

import os
import logging
from pathlib import Path

from dotenv import load_dotenv
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


async def init_db() -> None:
    """Verifica connessione al database."""
    try:
        async with engine.begin() as conn:
            # Verifica che la connessione funzioni
            await conn.run_sync(lambda c: None)
        logger.info(f"Database connesso: {DATABASE_URL.split('@')[-1]}")
    except Exception as e:
        logger.error(f"Errore connessione database: {e}")
        raise


async def close_db() -> None:
    """Chiude il pool di connessioni."""
    await engine.dispose()
    logger.info("Pool connessioni database chiuso.")
