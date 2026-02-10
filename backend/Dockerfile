# ============================================
# Backend API — Dockerfile
# FastAPI + Uvicorn
# ============================================

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Dipendenze di sistema per psycopg (PostgreSQL driver)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Dipendenze Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Codice sorgente (in dev montato come volume)
COPY src/ /app/src/

# Uvicorn con hot-reload in dev
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
