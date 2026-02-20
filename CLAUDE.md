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

| Servizio         | Porta | Descrizione                                      |
|------------------|-------|--------------------------------------------------|
| video_analyzer   | —     | Pipeline YOLO, no porta esposta                  |
| backend          | 8000  | FastAPI REST API                                 |
| frontend         | 5173  | React dev server (dev) / nginx (prod)            |
| mosquitto        | 1883  | MQTT broker                                      |
| postgres         | 5432  | Database eventi                                  |
| pgadmin          | 8080  | Admin DB (opzionale, profile=tools)              |

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

### 7. Architettura ROI Engine (Fase 2)
- **Poligoni liberi** via Shapely (non limitati a rettangoli)
- **Punto di intersezione configurabile per ROI**: bottom_center (default), centroid, top_center
- **Gerarchia padre/figlio** con `parent_id` (es. "Zona Nord" contiene "Corsia A-01")
- **Stato tracker per ROI**: is_inside, entered_at, dwell_seconds
- **3 tipi di evento**: `roi_enter`, `roi_exit`, `dwell_time` (soglia configurabile)
- **Tracker persi**: tolleranza 1s prima di generare exit (evita falsi exit per frame drop)
- ROI definite in coordinate pixel assolute nel piano immagine (no calibrazione camera)
- Caricamento ROI da file JSON (`data/rois.json`) nel video_analyzer
- Gestione ROI via REST API (`/api/rois`) e frontend ROI Editor (Fase 5 completata)

### 8. Event Manager MQTT (Fase 2)
- paho-mqtt 2.x con MQTTv5, QoS 1 (at least once)
- Connessione non bloccante con `loop_start()` + riconnessione automatica
- Schema JSON versionato (`schema_version: "1.0"`) per compatibilità backend
- Timestamp ISO 8601 UTC
- Graceful degradation: se MQTT offline, il sistema continua (eventi solo nel log)
- Topic: `logistics/events` (configurabile via env)

### 9. Funzionalità NON implementate (scelta consapevole)
- **Tripwire/Loitering**: interfacce predisposte, implementazione Fase 4+
- **Re-ID embeddings**: ByteTrack sufficiente per 3-8 muletti, re-ID per Fase 5+
- **Abbandono oggetto**: irrilevante per muletti
- **Calibrazione camera prospettica**: ROI nel piano immagine, ridisegnare se camera si muove

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
| Geometria ROI    | Shapely                             | ≥2.0       |
| Frontend         | React 19 + Vite 7 + Tailwind 4     | —          |
| Routing          | React Router                        | 7.x        |
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
│   ├── data/
│   │   └── rois.json           # Definizione ROI poligonali (JSON)
│   └── src/
│       ├── main.py             # Entry point pipeline completa
│       ├── config.py           # Configurazione centralizzata (.env)
│       ├── video_source.py     # Astrazione sorgente RTSP/MP4
│       ├── detector.py         # YOLO detection + tracking
│       ├── reference_point.py  # Strategia punto di riferimento bbox
│       ├── roi_engine.py       # Poligoni ROI + stato enter/exit/dwell
│       └── event_manager.py    # Publisher MQTT eventi
│
├── backend/                    # Servizio: API REST
│   ├── Dockerfile
│   ├── requirements.txt
│   └── src/
│       ├── main.py             # FastAPI + lifespan (DB + MQTT)
│       ├── db/
│       │   ├── database.py     # Connessione async PostgreSQL
│       │   ├── models.py       # SQLAlchemy ORM models
│       │   └── init.sql        # Schema DDL iniziale
│       ├── models/
│       │   └── schemas.py      # Pydantic request/response
│       ├── routers/
│       │   ├── events.py       # GET eventi con filtri + paginazione + stats/summary
│       │   ├── cameras.py      # CRUD camere
│       │   └── rois.py         # CRUD ROI poligonali
│       └── services/
│           └── mqtt_listener.py # Subscribe MQTT → PostgreSQL
│
├── frontend/                   # Servizio: Dashboard React
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx             # Root + BrowserRouter + 5 route
│       ├── main.jsx
│       ├── index.css
│       ├── components/
│       │   ├── Layout/         # AppLayout, Header (health), Sidebar (nav)
│       │   ├── DataTable/      # Tabella generica con paginazione
│       │   ├── FilterPanel/    # Filtri dinamici (7 tipi)
│       │   └── StatCard.jsx    # Card statistiche dashboard
│       ├── Pages/
│       │   ├── Dashboard.jsx   # Stats + eventi recenti, auto-refresh 30s
│       │   ├── Events.jsx      # Tabella completa + filtri + paginazione
│       │   ├── Cameras.jsx     # CRUD camere (form modale + card grid)
│       │   ├── ROIEditor.jsx   # Canvas interattivo per disegno poligoni
│       │   └── Settings.jsx    # Placeholder (Fase futura)
│       ├── config/
│       │   ├── navigation.js   # Menu con filtro per ruolo
│       │   └── eventColumns.js # Colonne tabella + definizione filtri
│       ├── contexts/
│       │   └── AuthContext.jsx # Ruoli admin/user (auth simulata per ora)
│       ├── hooks/
│       │   └── useApi.js       # Hook generico API con loading/error/data
│       └── services/
│           └── api.js          # Client HTTP centralizzato (/api proxy)
│
├── mosquitto/                  # Config MQTT
│   └── config/
│       └── mosquitto.conf
│
└── docs/                       # Documentazione extra
```

---

## Fasi di sviluppo

| Fase | Stato | Descrizione                                                        |
|------|-------|--------------------------------------------------------------------|
| 0    | ✅    | Riorganizzazione repo + infrastruttura Docker                       |
| 1    | ✅    | Video Analyzer MVP: YOLO + sorgente video                          |
| 2    | ✅    | ROI Engine + Event Manager + MQTT publish                          |
| 3    | ✅    | Backend API: FastAPI + PostgreSQL + MQTT listener                   |
| 4    | ✅    | Frontend MVP: Dashboard + tabella eventi + filtri + paginazione    |
| 5    | ✅    | ROI Editor nel frontend (canvas poligonale + CRUD via API)         |
| 6    | 🔶    | Integrazione WMS: schema DB pronto, manca UI tag manuale           |
| 7    | 🔶    | Multi-camera: infrastruttura CRUD pronta, video_analyzer mono-cam  |
| 8    | ✅    | Responsive UI: sidebar mobile, dark theme, layout adattivo         |
| 9    | ⬜    | Event detail modal + export CSV/PDF                                |
| 10   | ⬜    | WMS UI: pannello tag manuale + matching view                       |
| 11   | ⬜    | Real-time updates: WebSocket/SSE per eventi live                   |
| 12   | ⬜    | Autenticazione reale: JWT + login page + multi-utente              |

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

## Note operative (emerse durante sviluppo)

### Python e PyTorch su Windows
- **Python 3.13 NON compatibile** con PyTorch su Windows (errore DLL c10.dll)
- Usare **Python 3.12.x** per il venv del video_analyzer
- PyTorch va installato dal canale CUDA specifico, non da PyPI generico:
  ```bash
  pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
  ```
- Driver NVIDIA: versione 591, CUDA 12.4

### Esecuzione video_analyzer
- Lanciare sempre dalla cartella `video_analyzer/` (non da `src/`):
  ```bash
  cd video_analyzer
  python src/main.py
  ```
- Il file `.env` viene letto dalla **root del progetto** (due livelli sopra `src/`)
- Per test con file MP4: `VIDEO_SOURCE=data/videos/NomeFile.mp4`
- Per RTSP: `VIDEO_SOURCE=rtsp://user:pass@IP:554/axis-media/media.amp`
- Camera di test: Axis all'indirizzo 192.168.0.223

### Comandi utili
- Pausa video: tasto `p`
- Quit: tasto `q`
- Reset stati ROI: tasto `r`
- Verifica GPU: `python -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"`

### ROI e MQTT
- Le ROI si configurano in `video_analyzer/data/rois.json` (coordinate pixel, frame 1280x720)
- Le ROI possono essere gestite anche via frontend (ROI Editor) tramite REST API `/api/rois`
- MQTT è opzionale in dev: se Mosquitto non è attivo, il sistema continua senza pubblicare eventi
- Per attivare Mosquitto: `docker compose up mosquitto -d`
- Per monitorare eventi MQTT: `docker exec -it mosquitto mosquitto_sub -t "logistics/events" -v`

### Frontend
- Dev server: `cd frontend && npm install && npm run dev` (porta 5173)
- Il proxy Vite mappa `/api` → `http://localhost:8000` e `/health` → `http://localhost:8000`
- In Docker: hot-reload via volume mount su `frontend/src`
- Autenticazione attualmente simulata (ruolo `admin` fisso in `AuthContext.jsx`)
- Per usare pgadmin: `docker compose --profile tools up pgadmin -d` → http://localhost:8080

---

## Note e TODO

- [ ] Definire dataset per training custom modello YOLO (Fase futura)
- [ ] Definire protocollo WMS reale quando disponibile
- [ ] Implementare pannello WMS nel frontend (tag manuale + vista matching)
- [ ] Implementare event detail modal nel frontend (click su riga evento)
- [ ] Estendere video_analyzer per gestione multi-camera
- [ ] Implementare autenticazione reale: JWT + login page
- [ ] Aggiungere WebSocket/SSE per aggiornamenti eventi in real-time
- [ ] Valutare alerting real-time (notifiche push/email)
- [ ] Export eventi in CSV/PDF dalla pagina Events
