# CLAUDE.md — Memoria di Progetto LogisticsTrack

## Panoramica

**LogisticsTrack** è un sistema di videosorveglianza forense per la logistica.
Traccia muletti all'interno di corsie di magazzino, rileva l'estrazione di pallet
dagli scaffali, archivia gli eventi e permette l'integrazione con sistemi WMS esterni.

## Obiettivo principale

Rilevare quando un muletto con pallet entra in una ROI (corsia/scaffale),
tracciarlo per tutta la permanenza, generare un evento archiviabile e
permettere il matching con dati WMS per validazione automatica.

---

## Architettura

```
Camera RTSP / File MP4
        │
        ▼
┌─────────────────────┐
│  Video Analyzer      │  Python + YOLOv8 + CUDA (RTX 4090)
│  Detection/Tracking  │  ROI Engine + Event Generation
└────────┬────────────┘
         │ MQTT publish
         ▼
┌─────────────────────┐
│  Mosquitto MQTT      │  Broker messaggi
└────────┬────────────┘
         │ MQTT subscribe
         ▼
┌─────────────────────┐
│  FastAPI Backend     │  REST API + MQTT Listener
│  + PostgreSQL        │  Matching Engine (video ↔ WMS)
└────────┬────────────┘
         │ REST API
         ▼
┌─────────────────────┐
│  React Frontend      │  Dashboard multidevice
│  (Vite + Tailwind)   │  Responsive: PC, tablet, smartphone
└─────────────────────┘
```

### Servizi Docker

| Servizio         | Porta | Descrizione                        |
|------------------|-------|------------------------------------|
| video_analyzer   | —     | Pipeline YOLO, no porta esposta    |
| backend          | 8000  | FastAPI REST API                   |
| frontend         | 5173  | React dev server (dev) / nginx (prod) |
| mosquitto        | 1883  | MQTT broker                        |
| postgres         | 5432  | Database eventi                    |

---

## Decisioni architetturali prese

### 1. Niente Edge App Axis
Eliminata `acap_edge_app/`. Tutto lato server. Il deploy su camera Axis
non è un obiettivo attuale.

### 2. Node-RED eliminato
Sostituito con FastAPI come backend unico. Motivazione: versionabilità,
debugging, tipizzazione, performance.

### 3. Rilevamento pallet + muletto
- **Prototipo**: Approccio B — YOLO rileva `forklift` e `pallet` separatamente,
  logica spaziale verifica overlap (pallet sulle forche del muletto).
- **Produzione**: Approccio A — Modello custom con classe `forklift_with_pallet`.
  Richiede dataset e training dedicato.

### 4. Tracking muletti
Tracking con ID persistente (ByteTrack/BoTSORT integrato in Ultralytics).
L'evento traccia ingresso e uscita dalla ROI del singolo muletto.

### 5. Integrazione WMS
- Fase prototipo: campo di testo manuale con invio per simulare dati WMS.
- Finestra temporale configurabile per il matching evento video ↔ dato WMS.
- Protocollo WMS reale da definire in futuro.

### 6. Autenticazione
Single-user per ora. Utenti target: security management e amministratori.

---

## Stack tecnologico

| Componente       | Tecnologia                          | Versione   |
|------------------|-------------------------------------|------------|
| Detection AI     | Ultralytics YOLOv8                  | ≥8.2       |
| GPU              | NVIDIA RTX 4090 + CUDA             | CUDA 12.x  |
| Backend API      | FastAPI + Uvicorn                   | ≥0.115     |
| ORM              | SQLAlchemy                          | ≥2.0       |
| Database         | PostgreSQL                          | 16         |
| Broker MQTT      | Eclipse Mosquitto                   | 2.x        |
| MQTT Client      | paho-mqtt                           | 2.x        |
| Frontend         | React 19 + Vite 7 + Tailwind 4     | —          |
| Icone            | Lucide React                        | —          |
| Date             | date-fns                            | 4.x        |
| Container        | Docker + Docker Compose             | —          |
| Sviluppo         | VS Code su Windows + WSL2           | —          |

---

## Struttura cartelle

```
LogisticsTrack/
├── CLAUDE.md                   # Questo file
├── README.md                   # Documentazione pubblica
├── docker-compose.yml          # Orchestrazione dev
├── .env.example                # Template variabili ambiente
├── .gitignore
│
├── video_analyzer/             # Servizio: Analisi video
│   ├── Dockerfile
│   ├── requirements.txt
│   └── src/
│       ├── main.py
│       ├── detector.py
│       ├── roi_engine.py
│       ├── event_manager.py
│       ├── video_source.py
│       └── config.py
│
├── backend/                    # Servizio: API REST
│   ├── Dockerfile
│   ├── requirements.txt
│   └── src/
│       ├── main.py
│       ├── config.py
│       ├── routers/
│       ├── models/
│       ├── db/
│       └── services/
│
├── frontend/                   # Servizio: Dashboard React
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx
│       ├── components/
│       ├── pages/
│       ├── hooks/
│       └── services/
│
├── mosquitto/                  # Config MQTT
│   └── config/
│       └── mosquitto.conf
│
└── docs/                       # Documentazione extra
```

---

## Fasi di sviluppo

| Fase | Stato | Descrizione                                      |
|------|-------|--------------------------------------------------|
| 0    | ✅    | Riorganizzazione repo + infrastruttura Docker     |
| 1    | ✅    | Video Analyzer MVP: YOLO + sorgente video         |
| 2    | ⬜    | ROI Engine: zone + trigger eventi                 |
| 3    | ⬜    | Backend API: FastAPI + PostgreSQL + MQTT listener  |
| 4    | ⬜    | Frontend MVP: tabella eventi + ricerca            |
| 5    | ⬜    | ROI Editor nel frontend                           |
| 6    | ⬜    | Integrazione WMS: tag manuale + matching          |
| 7    | ⬜    | Multi-camera support                              |
| 8    | ⬜    | Responsive UI + ottimizzazioni                    |

---

## Convenzioni di sviluppo

### Commit
- Formato: `tipo: descrizione breve`
- Tipi: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`
- Un commit per ogni step completato e funzionante

### Codice Python
- Type hints obbligatori
- Docstring per classi e funzioni pubbliche
- Logging strutturato (no print)
- Configurazione via variabili ambiente + .env

### Codice React
- Componenti funzionali con hooks
- Una cartella per componente complesso (componente + stili)
- API calls centralizzate in `services/api.js`

### Docker
- Ogni servizio ha il suo Dockerfile
- `docker-compose.yml` per orchestrazione dev
- Volumi per persistenza dati e hot-reload in dev

---

## Sorgenti video per test

- **RTSP**: Stream da camera reale sulla rete locale
- **File MP4**: Video registrati di magazzino/muletti
- In produzione: solo RTSP, multi-camera

---

## Note e TODO

- [ ] Definire dataset per training custom modello YOLO (Fase futura)
- [ ] Definire protocollo WMS reale quando disponibile
- [ ] Valutare autenticazione multi-utente (Fase futura)
- [ ] Valutare alerting real-time (notifiche push/email)
