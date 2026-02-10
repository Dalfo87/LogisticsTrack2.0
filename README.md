# LogisticsTrack

Sistema di videosorveglianza forense per la logistica. Traccia muletti e pallet all'interno delle corsie di magazzino, archivia gli eventi e li integra con dati WMS esterni.

## Architettura

Il sistema è composto da 4 servizi containerizzati:

- **Video Analyzer** — Pipeline di analisi video con YOLOv8 + CUDA per rilevamento muletti/pallet e tracking in tempo reale
- **Backend API** — FastAPI che riceve eventi via MQTT, li archivia su PostgreSQL e espone REST API
- **Frontend** — Dashboard React responsive per visualizzazione eventi, configurazione ROI e integrazione WMS
- **Mosquitto** — Broker MQTT per comunicazione asincrona tra video analyzer e backend

## Requisiti

- Docker + Docker Compose
- NVIDIA GPU con driver aggiornati (RTX 4090 consigliata)
- NVIDIA Container Toolkit (per GPU in Docker)
- Node.js 20+ (solo per sviluppo frontend locale)

## Quick Start

```bash
# 1. Clona e configura
git clone https://github.com/tuouser/LogisticsTrack.git
cd LogisticsTrack
cp .env.example .env
# Modifica .env con i tuoi valori

# 2. Avvia tutti i servizi
docker compose up -d

# 3. Accedi alla dashboard
# Frontend: http://localhost:5173
# API docs: http://localhost:8000/docs
```

## Sviluppo

```bash
# Frontend (hot-reload)
cd frontend && npm install && npm run dev

# Backend (hot-reload)
cd backend && pip install -r requirements.txt
uvicorn src.main:app --reload --port 8000

# Video Analyzer
cd video_analyzer && pip install -r requirements.txt
python src/main.py
```

## Struttura progetto

```
LogisticsTrack/
├── video_analyzer/     # Pipeline YOLO + tracking + ROI
├── backend/            # FastAPI + PostgreSQL + MQTT listener
├── frontend/           # React + Vite + Tailwind
├── mosquitto/          # Configurazione broker MQTT
├── docker-compose.yml  # Orchestrazione servizi
└── CLAUDE.md           # Contesto e decisioni di progetto
```

## Documentazione

- [CLAUDE.md](CLAUDE.md) — Contesto progetto, decisioni architetturali, stato sviluppo
- [API Docs](http://localhost:8000/docs) — Swagger UI automatica (quando il backend è attivo)

## License

Proprietary — Tutti i diritti riservati.
