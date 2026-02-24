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
| video_analyzer   | 8765  | Pipeline YOLO + stream server MJPEG              |
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

### 9. Architettura modulare Video Analyzer (Fase 9 — v2.0)

Il video analyzer è stato refactored in un'architettura **multi-modulo**:

```
video_analyzer/src/modules/
├── __init__.py
├── base.py            # BaseVideoModule ABC + BaseEvent + FrameMeta
├── logistics.py       # Wrappa ROIEngine (invariato sotto)
└── no_entry_filter.py # YOLO26-Pose + torso crop + VestColorClassifier
```

**Interfacce chiave:**
- `BaseVideoModule` — ABC con: `module_type`, `initialize(config)`, `process_frame(frame, detections, meta)`, `draw_overlay(frame, events)`, `reset()`, `on_reload_signal()`
- `BaseEvent` — dataclass unificata: `event_type`, `camera_id`, `timestamp`, `module_type`, `track_id`, `confidence`, `bbox`, `event_data: dict`, `crop_filename`
- `FrameMeta` — dataclass: `timestamp`, `frame_idx`, `camera_id`, `width`, `height`

**NoEntryFilterModule:**
- Usa YOLO26-Pose per keypoints (17-point COCO)
- `extract_torso_crop(frame, keypoints)` — estrae crop torso da shoulder/hip keypoints
- `VestColorClassifier` ABC — `HSVClassifier` (default, ~80% accuracy) + `MLClassifier` (stub)
- `PersonTrackerState` — smoothing temporale via `deque(maxlen=N)` + voto a maggioranza
- Genera eventi: `person_no_vest` / `person_unauthorized`

**Configurazione moduli (`data/modules.json`):**
```json
{"modules": [
  {"type": "logistics", "enabled": true, "config": {"roi_file": "data/rois.json"}},
  {"type": "no_entry_filter", "enabled": false, "config": {"pose_model_path": null, ...}}
]}
```

**MQTT Payload v2.0:**
- `schema_version: "2.0"`, aggiunge `module_type` e `event_data: dict`
- Backend gestisce retrocompatibilità v1.0 (packed in event_data)
- Topic aggiuntivo: `logistics/control/reload_modules`

### 10. Schema DB multi-modulo (v2.0)
- `events.module_type` (VARCHAR 50, default "logistics") + `idx_events_module_type`
- `events.event_data` (JSONB — ex `raw_data`, contiene dati specifici del modulo)
- `rois.module_type` (VARCHAR 50, default "logistics") + `idx_rois_module_type`
- `cameras.modules_config` (JSONB — config moduli attivi per camera)
- Migration script incluso in `init.sql` (sezione "MIGRATION v1.0 → v2.0")

### 11. Funzionalità NON implementate (scelta consapevole)
- **Tripwire/Loitering**: interfacce predisposte, implementazione Fase 4+
- **Re-ID embeddings**: ByteTrack sufficiente per 3-8 muletti, re-ID per Fase 5+
- **Abbandono oggetto**: irrilevante per muletti
- **Calibrazione camera prospettica**: ROI nel piano immagine, ridisegnare se camera si muove
- **YOLO26-Pose per NoEntryFilter**: modulo in stub finché `pose_model_path` non è configurato

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
├── .env                        # Variabili ambiente (non versionato)
├── .gitignore
│
├── video_analyzer/             # Servizio: Analisi video
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── models/                 # Modelli YOLO .pt (selezionabili via UI Settings)
│   │   └── best.pt
│   ├── data/
│   │   ├── rois.json           # Definizione ROI poligonali (JSON)
│   │   ├── modules.json        # Config moduli attivi (logistics, no_entry_filter, ...)
│   │   └── videos/             # Video MP4 per test locale
│   └── src/
│       ├── main.py             # Entry point pipeline + outer restart loop + _load_modules
│       ├── config.py           # Configurazione centralizzata (.env + modules_file)
│       ├── video_source.py     # Astrazione sorgente RTSP/MP4
│       ├── detector.py         # YOLO detection + tracking (model_path_override)
│       ├── reference_point.py  # Strategia punto di riferimento bbox
│       ├── roi_engine.py       # Poligoni ROI + stato enter/exit/dwell
│       ├── event_manager.py    # Publisher MQTT eventi BaseEvent (payload v2.0)
│       ├── stream_server.py    # MJPEG stream server (porta 8765) + API runtime YOLO
│       └── modules/            # Package moduli di analisi (v2.0)
│           ├── __init__.py
│           ├── base.py         # BaseVideoModule ABC + BaseEvent + FrameMeta
│           ├── logistics.py    # Wrappa ROIEngine → BaseVideoModule
│           └── no_entry_filter.py  # YOLO-Pose + torso crop + VestColorClassifier
│
├── backend/                    # Servizio: API REST
│   ├── Dockerfile
│   ├── requirements.txt        # include docker>=7.0.0 per services.py
│   └── src/
│       ├── main.py             # FastAPI + lifespan (DB + MQTT)
│       ├── db/
│       │   ├── database.py     # Connessione async PostgreSQL
│       │   ├── models.py       # SQLAlchemy ORM models
│       │   └── init.sql        # Schema DDL iniziale
│       ├── models/
│       │   └── schemas.py      # Pydantic request/response
│       ├── routers/
│       │   ├── events.py       # GET eventi + stats/summary + SSE + filtro module_type + RBAC template
│       │   ├── cameras.py      # CRUD camere + /modules GET/PUT/export
│       │   ├── rois.py         # CRUD ROI poligonali + filtro module_type
│       │   └── services.py     # Stato e restart container Docker (/api/services)
│       └── services/
│           └── mqtt_listener.py # Subscribe MQTT → PostgreSQL + SSE pub/sub (subscribe_sse/unsubscribe_sse)
│
├── frontend/                   # Servizio: Dashboard React
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.js          # Proxy: /api→8000, /health→8000, /video-stream→8765
│   └── src/
│       ├── App.jsx             # Root + BrowserRouter + routing gerarchico /settings/*
│       ├── main.jsx
│       ├── index.css
│       ├── components/
│       │   ├── Layout/         # AppLayout, Header (health), Sidebar (collapsible nav v2.0)
│       │   ├── DataTable/      # Tabella generica con paginazione
│       │   ├── FilterPanel/    # Filtri dinamici (7 tipi)
│       │   ├── ImageLightbox/  # Modale lightbox per immagini crop eventi
│       │   ├── ROICanvas/      # Canvas interattivo poligoni ROI
│       │   └── StatCard.jsx    # Card statistiche dashboard
│       ├── Pages/
│       │   ├── Dashboard.jsx   # Stats + eventi recenti, SSE live + polling 5s + refresh manuale
│       │   ├── Events.jsx      # Tabella + filtri + paginazione + filtro module_type
│       │   ├── VideoAnalyzer.jsx # Stream MJPEG live con toggle overlay FPS/MQTT (/live)
│       │   ├── Settings/       # Sezione impostazioni gerarchica (v2.0)
│       │   │   ├── SettingsLayout.jsx  # Layout con sub-nav + Outlet
│       │   │   ├── CamerasSettings.jsx # Lista telecamere + CRUD (/settings/cameras)
│       │   │   ├── CameraDetail.jsx    # Tab Info|Moduli|ROI (/settings/cameras/:id)
│       │   │   ├── ModulesTab.jsx      # Toggle moduli + export al video_analyzer
│       │   │   ├── ROITab.jsx          # Canvas ROI filtrato per module_type
│       │   │   └── AnalyzerSettings.jsx # YOLO + parametri rilevamento (/settings/analyzer)
│       │   ├── [legacy] Cameras.jsx     # DEPRECATO — redirect a /settings/cameras
│       │   ├── [legacy] ROIEditor.jsx   # DEPRECATO — integrato in CameraDetail/ROITab
│       │   └── [legacy] Settings.jsx    # Re-esportato da AnalyzerSettings.jsx
│       ├── config/
│       │   ├── navigation.js   # Menu collassibile: Impostazioni → Telecamere | Video Analyzer
│       │   └── eventColumns.js # Colonne tabella + filtri (incl. module_type, event_data)
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
| 8    | ✅    | Responsive UI + Video Live (MJPEG stream) + Services monitor       |
| 8.1  | ✅    | stream_server.py: MJPEG + API runtime (confidence, IoU, model)    |
| 8.2  | ✅    | Settings: selezione modello YOLO da models/ + restart loop         |
| 8.3  | ✅    | Settings: parametri YOLO editabili + bbox visual props + classi   |
| 8.4  | ✅    | ROI Editor: modifica vertici drag + toggle active + snap a griglia |
| 8.5  | ✅    | VideoAnalyzer: toggle overlay FPS/MQTT                             |
| 8.6  | ✅    | Dashboard: SSE real-time + polling 5s + refresh manuale            |
| 8.7  | ✅    | Backend SSE: /api/events/stream + mqtt_listener pub/sub             |
| 9    | ✅    | Architettura modulare: BaseVideoModule + NoEntryFilter + Settings gerarchico |
| 9.1  | ✅    | Video Analyzer: modules/ (base, logistics, no_entry_filter) + modules.json |
| 9.2  | ✅    | Backend: module_type su events/rois, modules_config su cameras, MQTT v2.0 |
| 9.3  | ✅    | Frontend: /settings/* gerarchico, CameraDetail tab Info|Moduli|ROI |
| 10   | ⬜    | Event detail modal + export CSV/PDF                                |
| 11   | ⬜    | WMS UI: pannello tag manuale + matching view                       |
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
- Proxy Vite: `/api` → `http://localhost:8000`, `/health` → `http://localhost:8000`, `/video-stream` → `http://localhost:8765`
- In Docker: hot-reload via volume mount su `frontend/src`
- Autenticazione attualmente simulata (ruolo `admin` fisso in `AuthContext.jsx`)
- Per usare pgadmin: `docker compose --profile tools up pgadmin -d` → http://localhost:8080

### Stream Server MJPEG (video_analyzer)
- Abilitare con `VA_STREAM_ENABLED=true` (default: true) e `VA_STREAM_PORT=8765` (default: 8765)
- Endpoint: `GET /stream` (MJPEG), `GET /config`, `PATCH /config`, `POST /restart`, `GET /health`, `GET /models`, `GET /classes`
- Il frontend accede via proxy Vite `/video-stream/*` → `http://localhost:8765/*`
- Pagina "Video Live" (`/live`): visualizza stream in tempo reale con overlay YOLO + toggle overlay
- Il server sopravvive ai restart del loop principale (thread daemon idempotente)

### Parametri runtime YOLO (stream server)
- `confidence` (float 0.1-1.0), `iou` (float 0.1-1.0), `target_classes` (list[int] | null)
- `model_path` (str | null) — richiede restart loop
- `bbox_thickness` (int 1-8), `font_scale` (float 0.3-1.5), `font_thickness` (int 1-4)
- `show_label` (bool), `show_dot` (bool), `jpeg_quality` (int 20-95), `show_overlay` (bool)
- Tutti aggiornabili via `PATCH /video-stream/config` dal frontend Settings
- `show_overlay` controlla anche overlay FPS/MQTT nella pagina Video Live (toggle button)

### ROI Editor — modifica ROI esistenti
- Clic sulla ROI nella lista → apre pannello edit con: nome, aisle_id, toggle attiva
- Pulsante "Modifica vertici" → attiva edit-mode canvas: drag dei vertex handles
- Mouseup → `onVerticesChanged(newPoints)` → "Salva vertici" → PUT /api/rois/{id}
- Toggle attivo inline (clic sull'icona CheckCircle2/XCircle) → PUT senza aprire il pannello
- Snap a griglia 20px togglable dalla toolbar (bottone "Snap ON/OFF")
- ROI disattive: bordo tratteggiato, semitrasparente (già funzionante nella versione precedente)
- Nota: campo `color` non supportato dal DB (ROI table non ha colonna color)

### Backend SSE (Server-Sent Events)
- Endpoint: `GET /api/events/stream` (text/event-stream)
- Ogni nuovo evento MQTT ricevuto e persistito viene broadcastato a tutti i client connessi
- Pattern: `MQTTListener.subscribe_sse()` → `asyncio.Queue`, `unsubscribe_sse()` alla disconnessione
- Keepalive ping ogni 30s con `: keepalive\n\n` per prevenire timeout proxy
- `app.state.mqtt_listener` espone il listener all'endpoint SSE via `request.app.state`
- Dashboard: `EventSource('/api/events/stream')` + polling 5s per stats + refresh manuale

### Selezione modello YOLO
- Posizionare i file `.pt` in `video_analyzer/models/`
- `GET /video-stream/models` lista i modelli disponibili con nome e dimensione
- `PATCH /video-stream/config` con `{model_path: "models/nome.pt"}` imposta il modello
- `POST /video-stream/restart` riavvia il loop di analisi con il nuovo modello (~3-5s downtime)
- Il loop principale (`main.py`) legge il `model_path` da `stream_server.get_runtime_config()` ad ogni avvio
- Configurabile anche da `Settings` nel frontend (pagina Impostazioni)

### Backend services.py
- Router `/api/services`: stato container Docker (`GET`) e restart (`POST /{name}/restart`)
- Richiede che `/var/run/docker.sock` sia montato nel container backend
- Dipendenza: `docker>=7.0.0` in `backend/requirements.txt`
- Postgres è in `RESTART_BLOCKED` (restart non consentito via API)

### Impostazioni gerarchiche (v2.0)
- URL structure: `/settings/cameras` → lista, `/settings/cameras/:id` → dettaglio, `/settings/analyzer` → YOLO
- `CameraDetail.jsx` ha 3 tab: **Info** (form + snapshot), **Moduli** (toggle abilitazione), **ROI** (canvas editor)
- `ModulesTab`: toggle per ogni modulo → "Salva configurazione" (PUT /cameras/:id/modules) → "Esporta al motore" (POST /cameras/:id/modules/export)
- L'esportazione scrive `data/modules.json` e pubblica segnale MQTT su `logistics/control/reload_modules`
- `ROITab`: selettore module_type (logistics / no_entry_filter) → carica ROI filtrate via `GET /api/rois?camera_id=&module_type=`
- Le ROI create nel ROITab includono automaticamente `module_type` nel body della POST
- Vecchie route `/cameras` e `/rois` reindirizzano a `/settings/cameras`

### Moduli Video Analyzer (v2.0)
- Configurazione moduli per camera gestita da frontend (tab Moduli in CameraDetail)
- Il pulsante "Esporta al motore" in ModulesTab → scrive `modules.json` → video_analyzer legge al prossimo restart loop
- Per hot-reload moduli senza restart: `POST /api/cameras/:id/modules/export` → MQTT signal `reload_modules`
- `NoEntryFilterModule` è in stub finché `pose_model_path` non è configurato nel `modules.json`
- Per monitorare segnali reload: `docker exec -it mosquitto mosquitto_sub -t "logistics/control/#" -v`

### Migrazione DB v1.0 → v2.0
- Se il DB è già esistente (v1.0), eseguire la sezione MIGRATION in `backend/src/db/init.sql`
- Script sicuro: usa `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` e `DO $$ ... IF EXISTS $$`
- La colonna `raw_data` viene rinominata `event_data` automaticamente se esiste
- Per eseguire manualmente: `docker exec -it postgres psql -U logisticstrack -d logisticstrack -f /docker-entrypoint-initdb.d/init.sql`

---

## Note e TODO

### Prossimi step immediati
- [ ] Eseguire migrazione DB v1.0 → v2.0 su DB esistenti (vedi sezione "Migrazione DB v1.0 → v2.0")
- [ ] Configurare `pose_model_path` in `modules.json` quando YOLO-Pose è disponibile per attivare NoEntryFilterModule
- [ ] Rimuovere file legacy (`Cameras.jsx`, `ROIEditor.jsx`, `Settings.jsx`) dopo verifica end-to-end

### Funzionalità future
- [ ] Implementare event detail modal nel frontend (click su riga evento) — Fase 10
- [ ] Export eventi in CSV/PDF dalla pagina Events — Fase 10
- [ ] Implementare pannello WMS nel frontend (tag manuale + vista matching) — Fase 11
- [ ] Implementare autenticazione reale: JWT + login page + multi-utente — Fase 12
- [ ] Estendere video_analyzer per gestione multi-camera (istanza per camera o multi-thread)
- [ ] Valutare alerting real-time (notifiche push/email)

### Evoluzioni architetturali
- [ ] Definire dataset per training custom modello YOLO (Fase futura)
- [ ] Definire protocollo WMS reale quando disponibile
- [ ] Aggiungere campo `color` [R,G,B] alla tabella ROI (migration) + sync con frontend
- [ ] Aggiungere campo `dwell_threshold_sec` alla tabella ROI (migration) + UI Settings ROI
- [ ] Implementare MLClassifier per NoEntryFilterModule (EfficientNet-B0 o simile) quando dataset DPI è disponibile
