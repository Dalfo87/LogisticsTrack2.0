# Guida Didattica Completa — LogisticsTrack

> Questa guida analizza **ogni file** del progetto LogisticsTrack, spiegandone scopo, funzionamento e concetti di programmazione in modo progressivo, pensato per chi sta imparando.

---

## Indice

- [PARTE 0 — Introduzione al Progetto](#parte-0--introduzione-al-progetto)
- [PARTE 1 — Infrastruttura e Configurazione](#parte-1--infrastruttura-e-configurazione)
- [PARTE 2 — Servizio Video Analyzer](#parte-2--servizio-video-analyzer-python--yolo--cuda)
- [PARTE 3 — Servizio Backend](#parte-3--servizio-backend-fastapi--postgresql)
- [PARTE 4 — Servizio Frontend](#parte-4--servizio-frontend-react--vite--tailwind)
- [PARTE 5 — Analisi Architetturale Finale](#parte-5--analisi-architetturale-finale)

---

# PARTE 0 — Introduzione al Progetto

## 0.1 Cos'e LogisticsTrack

**LogisticsTrack** e un sistema di videosorveglianza forense per la logistica.

**Il problema che risolve:** nei grandi magazzini, i muletti (forklifts) estraggono pallet dagli scaffali centinaia di volte al giorno. Sapere *chi* ha prelevato *cosa*, *dove* e *quando* e fondamentale per la sicurezza e la tracciabilita. LogisticsTrack automatizza questo monitoraggio usando l'intelligenza artificiale.

**Cosa fa concretamente:**
1. Riceve uno stream video da una telecamera (o un file video di test)
2. Usa un modello AI (YOLOv8) per rilevare muletti e pallet in ogni frame
3. Traccia ogni muletto con un ID persistente (es. "muletto #5")
4. Definisce zone rettangolari o poligonali nell'immagine (ROI — Region of Interest)
5. Quando un muletto entra o esce da una zona, genera un *evento*
6. L'evento viene pubblicato su un broker di messaggi (MQTT)
7. Un backend API riceve l'evento e lo salva in un database PostgreSQL
8. Un frontend web mostra gli eventi in una dashboard con filtri e statistiche

**Utenti target:** security management e amministratori di magazzino.

## 0.2 Architettura Generale

Il sistema e composto da **5 servizi** indipendenti che comunicano tra loro:

```
Camera RTSP / File MP4
        |
        v
+---------------------+
|  Video Analyzer      |  Python + YOLOv8 + CUDA (RTX 4090)
|  Detection/Tracking  |  ROI Engine + Event Generation
+--------+------------+
         | MQTT publish
         v
+---------------------+
|  Mosquitto MQTT      |  Broker messaggi
+--------+------------+
         | MQTT subscribe
         v
+---------------------+
|  FastAPI Backend     |  REST API + MQTT Listener
|  + PostgreSQL        |  Matching Engine (video - WMS)
+--------+------------+
         | REST API
         v
+---------------------+
|  React Frontend      |  Dashboard multidevice
|  (Vite + Tailwind)   |  Responsive: PC, tablet, smartphone
+---------------------+
```

### Tabella Servizi

| Servizio | Porta | Descrizione |
|----------|-------|-------------|
| `video_analyzer` | — | Pipeline YOLO detection + tracking, nessuna porta esposta |
| `backend` | 8000 | FastAPI REST API per query eventi e gestione camere |
| `frontend` | 5173 | React dev server (dashboard web) |
| `mosquitto` | 1883 | Broker MQTT per messaggistica asincrona |
| `postgres` | 5432 | Database PostgreSQL per archiviazione eventi |

**Perche servizi separati?** Ogni servizio fa una sola cosa ed e indipendente:
- Se il frontend crasha, il backend continua a ricevere eventi
- Se MQTT e offline, il video analyzer continua a rilevare
- Si puo aggiornare un servizio senza fermare gli altri
- Questo approccio si chiama **architettura a microservizi**

## 0.3 Stack Tecnologico

| Componente | Tecnologia | A cosa serve |
|------------|------------|--------------|
| AI Detection | Ultralytics YOLOv8 >=8.2 | Rileva oggetti (muletti, pallet) nei frame video |
| GPU | NVIDIA RTX 4090 + CUDA 12.x | Accelera i calcoli AI (100x piu veloce della CPU) |
| Backend API | FastAPI + Uvicorn >=0.115 | Framework web Python per API REST asincrone |
| ORM | SQLAlchemy >=2.0 | Mappa tabelle DB su classi Python (non scrivere SQL a mano) |
| Database | PostgreSQL 16 | Database relazionale per archiviare eventi |
| Broker MQTT | Eclipse Mosquitto 2.x | Instrada messaggi tra servizi (publish/subscribe) |
| MQTT Client | paho-mqtt 2.x | Libreria Python per parlare con Mosquitto |
| Geometria | Shapely >=2.0 | Calcoli geometrici (punto dentro un poligono?) |
| Frontend | React 19 + Vite 7 + Tailwind 4 | Interfaccia web reattiva e responsive |
| Icone | Lucide React | Set di icone SVG per l'interfaccia |
| Date | date-fns 4.x | Formattazione date in italiano |
| Container | Docker + Docker Compose | Isola ogni servizio in un container |

## 0.4 Struttura delle Cartelle

```
LogisticsTrack/
|-- CLAUDE.md                    # Memoria decisionale del progetto
|-- README.md                    # Documentazione pubblica
|-- docker-compose.yml           # Orchestrazione di tutti i servizi
|-- .gitignore                   # File da non versionare
|-- .env                         # Variabili d'ambiente (NON nel repo)
|
|-- video_analyzer/              # SERVIZIO: Analisi video AI
|   |-- Dockerfile               # Immagine Docker con NVIDIA CUDA
|   |-- requirements.txt         # Dipendenze Python
|   |-- data/
|   |   +-- rois.json            # Definizione zone ROI (poligoni)
|   +-- src/
|       |-- main.py              # Entry point: orchestra la pipeline
|       |-- config.py            # Configurazione centralizzata
|       |-- video_source.py      # Acquisizione frame (RTSP/MP4)
|       |-- detector.py          # YOLOv8 detection + ByteTrack tracking
|       |-- reference_point.py   # Calcolo punto di riferimento bbox
|       |-- roi_engine.py        # Motore geometrico ROI (518 righe)
|       +-- event_manager.py     # Pubblicazione eventi su MQTT
|
|-- backend/                     # SERVIZIO: API REST + persistenza
|   |-- Dockerfile               # Immagine Docker Python 3.12
|   |-- requirements.txt         # Dipendenze Python
|   +-- src/
|       |-- main.py              # Entry point FastAPI
|       |-- db/
|       |   |-- database.py      # Connessione async PostgreSQL
|       |   |-- models.py        # Modelli ORM (tabelle come classi)
|       |   +-- init.sql         # Schema SQL iniziale (4 tabelle)
|       |-- models/
|       |   +-- schemas.py       # Schemi Pydantic (validazione dati)
|       |-- routers/
|       |   |-- events.py        # API eventi (filtri + paginazione)
|       |   +-- cameras.py       # API camere (CRUD completo)
|       +-- services/
|           +-- mqtt_listener.py # Sottoscrizione MQTT -> PostgreSQL
|
|-- frontend/                    # SERVIZIO: Dashboard React
|   |-- Dockerfile               # Immagine Docker Node.js
|   |-- package.json             # Dipendenze JavaScript
|   |-- vite.config.js           # Configurazione build tool
|   |-- index.html               # HTML entry point
|   +-- src/
|       |-- main.jsx             # Bootstrap React
|       |-- App.jsx              # Root component con routing
|       |-- index.css            # Stili globali Tailwind
|       |-- contexts/
|       |   +-- AuthContext.jsx   # Gestione ruolo utente
|       |-- config/
|       |   |-- navigation.js    # Voci menu per ruolo
|       |   +-- eventColumns.js  # Colonne tabella + filtri
|       |-- services/
|       |   +-- api.js           # Client HTTP centralizzato
|       |-- hooks/
|       |   +-- useApi.js        # Hook generico per chiamate API
|       |-- components/
|       |   |-- Layout/
|       |   |   |-- AppLayout.jsx  # Shell: sidebar + header + content
|       |   |   |-- Header.jsx     # Barra superiore con stato sistema
|       |   |   +-- Sidebar.jsx    # Navigazione laterale
|       |   |-- StatCard.jsx       # Card con statistica
|       |   |-- DataTable/
|       |   |   +-- DataTable.jsx  # Tabella dati generica
|       |   +-- FilterPanel/
|       |       +-- FilterPanel.jsx # Pannello filtri dinamico
|       +-- pages/
|           |-- Dashboard.jsx    # Panoramica con statistiche
|           |-- Events.jsx       # Tabella eventi completa
|           |-- Cameras.jsx      # Gestione camere (CRUD)
|           +-- Settings.jsx     # Impostazioni (placeholder)
|
+-- mosquitto/                   # CONFIG: Broker MQTT
    +-- config/
        +-- mosquitto.conf       # Configurazione Mosquitto
```

---

# PARTE 1 — Infrastruttura e Configurazione

Questa sezione copre i file "di contorno" che definiscono come il progetto e organizzato, configurato e orchestrato.

---

## 1.1 `docker-compose.yml` — Orchestrazione Servizi

**Percorso:** `docker-compose.yml` (125 righe)

### Scopo
Definisce **tutti i servizi** del sistema e come comunicano tra loro. Con un solo comando (`docker compose up`) si avvia l'intero sistema.

### Ruolo nell'architettura
E il "direttore d'orchestra". Legge questo file, crea una rete virtuale, scarica le immagini necessarie e avvia ogni servizio nell'ordine corretto.

### Sezioni principali del codice

**Servizio Mosquitto (broker MQTT):**
```yaml
mosquitto:
  image: eclipse-mosquitto:2
  container_name: lt_mosquitto
  ports:
    - "1883:1883"
  volumes:
    - ./mosquitto/config:/mosquitto/config:ro
    - mosquitto_data:/mosquitto/data
```
- `image: eclipse-mosquitto:2` — usa un'immagine gia pronta (non serve build)
- `ports: "1883:1883"` — espone la porta 1883 del container sulla macchina host
- `volumes` — monta la configurazione (`:ro` = read-only) e i dati per la persistenza

**Servizio PostgreSQL (database):**
```yaml
postgres:
  image: postgres:16-alpine
  environment:
    POSTGRES_USER: ${POSTGRES_USER:-admin}
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-secure_password_2026}
    POSTGRES_DB: ${POSTGRES_DB:-logistics_track}
  volumes:
    - postgres_data:/var/lib/postgresql/data
    - ./backend/src/db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
```
- Le variabili `${VAR:-default}` leggono dal file `.env`, con un valore di fallback
- `init.sql` viene montato nella cartella speciale `docker-entrypoint-initdb.d/` — PostgreSQL lo esegue automaticamente al primo avvio

**Servizio Video Analyzer (con GPU):**
```yaml
video_analyzer:
  build:
    context: ./video_analyzer
    dockerfile: Dockerfile
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: 1
            capabilities: [gpu]
```
- `build:` — costruisce l'immagine dal Dockerfile locale (non scarica da internet)
- `deploy.resources.reservations` — riserva una GPU NVIDIA per questo container. Senza questa sezione, il container non vedrebbe la GPU.

**Servizio PgAdmin (opzionale):**
```yaml
pgadmin:
  profiles:
    - tools
```
- `profiles: [tools]` — questo servizio NON parte con `docker compose up`. Si avvia solo con `docker compose --profile tools up`. Utile per strumenti di debug.

**Rete e Volumi:**
```yaml
volumes:
  postgres_data:      # Dati del database (sopravvivono al riavvio)
  mosquitto_data:     # Messaggi MQTT persistenti
  mosquitto_log:      # Log di Mosquitto

networks:
  lt_net:
    driver: bridge    # Rete virtuale per far comunicare i container
```

### Flusso
`docker compose up` → crea rete `lt_net` → avvia mosquitto → avvia postgres → avvia backend (quando postgres e mosquitto sono pronti) → avvia video_analyzer → avvia frontend

### Dipendenze
- Tutti i Dockerfile dei servizi
- File `.env` per le variabili d'ambiente
- `mosquitto.conf` per la configurazione del broker
- `init.sql` per lo schema del database

### Concetti chiave

**Docker** e una tecnologia di *containerizzazione*: ogni servizio gira in un ambiente isolato con tutte le sue dipendenze. Immagina ogni container come una "scatola" con dentro il suo software — non interferisce con gli altri.

**Docker Compose** orchestra piu container: definisce come avviarli, in che ordine, come comunicano.

**Volumi** sono "cartelle persistenti". Quando un container viene distrutto e ricreato, i dati nei volumi sopravvivono (es. il database non perde i dati).

**Network bridge** e una rete virtuale: i container possono parlare tra loro usando i nomi dei servizi (es. il backend puo connettersi a `postgres:5432`).

**`depends_on`** dice a Docker di avviare un servizio *dopo* un altro. Attenzione: garantisce l'ordine di avvio, ma NON che il servizio sia pronto (il backend potrebbe avviarsi prima che PostgreSQL abbia finito l'inizializzazione).

---

## 1.2 `.gitignore` — Cosa NON Versionare

**Percorso:** `.gitignore` (48 righe)

### Scopo
Dice a Git quali file e cartelle **ignorare** — cioe non includere nel repository.

### Ruolo nell'architettura
Protegge il repository da file che non devono essere condivisi: credenziali, file temporanei, file pesanti.

### Sezioni principali

| Categoria | Pattern | Perche |
|-----------|---------|--------|
| Python | `__pycache__/`, `*.py[cod]`, `venv/` | File compilati e ambiente virtuale — si rigenerano |
| Credenziali | `.env` | Contiene password del database! Mai nel repo |
| Node.js | `node_modules/`, `dist/` | Dipendenze (si reinstallano), build (si ricostruisce) |
| Modelli YOLO | `*.pt`, `*.onnx`, `*.engine` | File pesanti (50-700 MB), si scaricano a runtime |
| Video test | `*.mp4`, `*.avi` | File molto pesanti, non vanno nel repo |
| Docker | `postgres_data/`, `mosquitto/data/` | Dati locali di sviluppo |
| IDE | `.vscode/`, `.idea/` | Configurazioni personali dell'editor |
| OS | `.DS_Store`, `Thumbs.db` | File nascosti del sistema operativo |

### Concetti chiave

**Git** e un sistema di *versionamento*: registra la storia di ogni modifica ai file del progetto. `.gitignore` gli dice "questi file non mi interessano".

**Perche non versionare file binari pesanti?** Git e ottimizzato per file di testo. Un modello YOLO da 200 MB renderebbe il repository lentissimo da clonare. Si scarica a runtime quando serve.

**Perche non versionare `.env`?** Contiene password e credenziali. Se finisse su GitHub, chiunque potrebbe accedere al database.

---

## 1.3 `.env` — Variabili d'Ambiente

**Nota:** il file `.env` **non e nel repository** (e nel `.gitignore`). Il pattern e: si fornisce un file `.env.example` come template, lo sviluppatore lo copia in `.env` e personalizza i valori.

### Scopo
Contiene tutte le configurazioni sensibili e specifiche dell'ambiente (sviluppo, test, produzione).

### Variabili principali

| Variabile | Esempio | Usata da |
|-----------|---------|----------|
| `VIDEO_SOURCE` | `data/videos/test.mp4` | Video Analyzer |
| `YOLO_MODEL` | `yolov8n.pt` | Video Analyzer |
| `YOLO_CONFIDENCE` | `0.4` | Video Analyzer |
| `YOLO_DEVICE` | `0` (GPU) o `cpu` | Video Analyzer |
| `CAMERA_ID` | `CAM_DEV_01` | Video Analyzer |
| `ROI_FILE` | `data/rois.json` | Video Analyzer |
| `MQTT_BROKER` | `localhost` | Video Analyzer + Backend |
| `MQTT_PORT` | `1883` | Video Analyzer + Backend |
| `MQTT_TOPIC_EVENTS` | `logistics/events` | Video Analyzer + Backend |
| `DATABASE_URL` | `postgresql+asyncpg://admin:pass@localhost:5432/logistics_track` | Backend |
| `POSTGRES_USER` | `admin` | PostgreSQL container |
| `POSTGRES_PASSWORD` | `secure_password_2026` | PostgreSQL container |

### Concetti chiave

**12-factor app** e una metodologia di sviluppo che dice: "la configurazione va nell'ambiente, non nel codice". Cosi lo stesso codice funziona in sviluppo (con `localhost`) e in produzione (con il server reale) senza modifiche.

**dotenv** e una libreria Python/Node.js che legge il file `.env` e rende le variabili disponibili tramite `os.getenv()`.

---

## 1.4 `mosquitto/config/mosquitto.conf` — Configurazione Broker MQTT

**Percorso:** `mosquitto/config/mosquitto.conf` (18 righe)

### Scopo
Configura il broker MQTT Eclipse Mosquitto.

### Ruolo nell'architettura
Mosquitto e il "postino" del sistema: riceve messaggi dal Video Analyzer e li consegna al Backend. Questa configurazione definisce come funziona il postino.

### Sezioni principali del codice

```
# Persistenza messaggi
persistence true
persistence_location /mosquitto/data/

# Logging
log_dest file /mosquitto/log/mosquitto.log
log_type all

# Listener MQTT standard
listener 1883

# Dev: connessioni anonime permesse
# PRODUZIONE: impostare a false e configurare ACL + password
allow_anonymous true
```

- **`persistence true`** — salva i messaggi su disco. Se Mosquitto si riavvia, i messaggi non consegnati non vanno persi.
- **`listener 1883`** — ascolta sulla porta 1883 (porta standard MQTT).
- **`allow_anonymous true`** — accetta connessioni senza username/password. **Solo per sviluppo!** In produzione servono autenticazione e ACL (Access Control List).

### Flusso
Video Analyzer pubblica su topic `logistics/events` → Mosquitto riceve → Backend sottoscrive lo stesso topic → Mosquitto consegna

### Concetti chiave

**MQTT (Message Queuing Telemetry Transport)** e un protocollo di messaggistica leggero basato sul pattern **Publish/Subscribe**:

```
Publisher -----> [BROKER] -----> Subscriber
(Video Analyzer)   |         (Backend)
                   |
            Topic: "logistics/events"
```

- Il **Publisher** invia messaggi su un *topic* (canale)
- Il **Subscriber** si iscrive al topic e riceve i messaggi
- Il **Broker** (Mosquitto) fa da intermediario
- Publisher e Subscriber **non si conoscono** — questo si chiama *disaccoppiamento*

**Differenza con REST:**
- REST e *sincrono*: "mando una richiesta, aspetto la risposta"
- MQTT e *asincrono*: "mando un messaggio e continuo a lavorare, il destinatario lo legge quando vuole"

**QoS (Quality of Service)** — livelli di garanzia consegna:
- QoS 0: "fire and forget" — il messaggio potrebbe perdersi
- QoS 1: "at least once" — il messaggio arriva almeno una volta (usato in LogisticsTrack)
- QoS 2: "exactly once" — garanzia massima, ma piu lento

---

# PARTE 2 — Servizio Video Analyzer (Python + YOLO + CUDA)

Il Video Analyzer e il **cuore** del sistema. Elabora i frame video, rileva oggetti con AI, li traccia e genera eventi quando entrano o escono dalle zone monitorate.

**Pipeline dati:**
```
VideoSource → Detector → ROIEngine → EventManager → Display
(frame)     (detection) (eventi ROI) (MQTT publish)  (schermo)
```

---

## 2.1 `video_analyzer/Dockerfile` — Immagine Docker con GPU

**Percorso:** `video_analyzer/Dockerfile` (33 righe)

### Scopo
Definisce come costruire l'immagine Docker per il Video Analyzer, incluso il supporto GPU NVIDIA.

### Sezioni principali del codice

```dockerfile
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Dipendenze sistema per OpenCV e video processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-dev \
    libgl1-mesa-glx libglib2.0-0 libsm6 libxext6 libxrender-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

COPY src/ /app/src/

CMD ["python3", "src/main.py"]
```

### Concetti chiave

- **`FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04`** — l'immagine base include i driver NVIDIA CUDA. Senza questa base, YOLO non potrebbe usare la GPU.
- **`libgl1-mesa-glx` e `ffmpeg`** — OpenCV ha bisogno di queste librerie di sistema per processare video.
- **Layer caching**: il `COPY requirements.txt` viene *prima* di `COPY src/`. Cosi Docker riusa il layer delle dipendenze (che cambiano raramente) e ricostruisce solo il codice sorgente (che cambia spesso). Questo velocizza il build.
- **`PYTHONUNBUFFERED=1`** — forza Python a stampare i log immediatamente, senza bufferizzare. Fondamentale per vedere i log in tempo reale in Docker.

---

## 2.2 `video_analyzer/requirements.txt` — Dipendenze Python

**Percorso:** `video_analyzer/requirements.txt` (9 righe)

### Scopo
Elenca tutte le librerie Python necessarie al Video Analyzer.

### Ogni dipendenza spiegata

| Libreria | Versione | A cosa serve |
|----------|----------|-------------|
| `ultralytics` | >=8.2.0 | Framework YOLOv8: detection, tracking, gestione modelli |
| `opencv-python` | >=4.9.0 | Cattura video, manipolazione frame, visualizzazione |
| `paho-mqtt` | >=2.1.0 | Pubblicazione messaggi su broker MQTT |
| `numpy` | >=1.26.0 | Manipolazione array numerici (i frame sono array numpy) |
| `shapely` | >=2.0.0 | Geometria computazionale (punto dentro un poligono?) |
| `python-dotenv` | >=1.0.0 | Caricamento variabili da file `.env` |

---

## 2.3 `video_analyzer/data/rois.json` — Definizione Zone ROI

**Percorso:** `video_analyzer/data/rois.json` (41 righe)

### Scopo
Definisce le **Zone di Interesse** (ROI) che il sistema deve monitorare. Ogni ROI e un poligono disegnato sullo schermo.

### Contenuto

```json
{
  "rois": [
    {
      "id": "ROI_A01",
      "name": "Corsia A-01",
      "aisle_id": "A-01",
      "camera_id": "CAM_DEV_01",
      "points": [[200, 200], [500, 200], [500, 550], [200, 550]],
      "reference_point": "bottom_center",
      "parent_id": null,
      "color": [0, 255, 0],
      "is_active": true,
      "dwell_threshold_sec": 5.0
    }
  ]
}
```

### Ogni campo spiegato

| Campo | Significato | Esempio |
|-------|------------|---------|
| `id` | Identificativo unico della ROI | `"ROI_A01"` |
| `name` | Nome leggibile | `"Corsia A-01"` |
| `aisle_id` | ID della corsia logica (per matching WMS) | `"A-01"` |
| `camera_id` | A quale camera appartiene | `"CAM_DEV_01"` |
| `points` | Vertici del poligono in **pixel** `[[x,y], ...]` | `[[200,200], [500,200], ...]` |
| `reference_point` | Quale punto del muletto usare per il check | `"bottom_center"` |
| `parent_id` | ROI padre (per gerarchie) | `null` = nessun padre |
| `color` | Colore BGR dell'overlay | `[0, 255, 0]` = verde |
| `is_active` | Se la ROI e attiva | `true` / `false` |
| `dwell_threshold_sec` | Dopo quanti secondi generare un allarme "sosta" | `5.0` secondi |

### Concetti chiave

**ROI (Region of Interest)** e una zona dell'immagine che ci interessa monitorare. In un magazzino, ogni corsia tra gli scaffali e una ROI.

**Coordinate pixel:** su un frame 1280x720, il punto `[200, 200]` e a 200 pixel dal bordo sinistro e 200 pixel dall'alto. Le coordinate definiscono i vertici di un poligono.

**Poligono:** una forma geometrica con almeno 3 vertici. Un rettangolo ha 4 vertici, ma le ROI possono avere qualsiasi forma (utile per corsie inclinate).

---

## 2.4 `video_analyzer/src/config.py` — Configurazione Centralizzata

**Percorso:** `video_analyzer/src/config.py` (69 righe)

### Scopo
Raccoglie **tutta** la configurazione del Video Analyzer in un unico posto, leggendo i valori dalle variabili d'ambiente.

### Ruolo nell'architettura
Ogni altro modulo riceve un oggetto `VideoAnalyzerConfig` e legge i parametri da li. Nessun modulo accede direttamente alle variabili d'ambiente.

### Sezioni principali del codice

```python
from dataclasses import dataclass

@dataclass
class VideoAnalyzerConfig:
    """Configurazione completa del Video Analyzer."""

    # Sorgente video: path file MP4 o URL RTSP
    video_source: str = os.getenv("VIDEO_SOURCE", "data/videos/test.mp4")

    # Modello YOLO
    yolo_model: str = os.getenv("YOLO_MODEL", "yolov8n.pt")
    yolo_confidence: float = float(os.getenv("YOLO_CONFIDENCE", "0.4"))

    # Classi da rilevare
    target_classes: list[int] | None = None

    def __post_init__(self) -> None:
        """Parsing target_classes da env se presente."""
        classes_env = os.getenv("TARGET_CLASSES", "")
        if classes_env:
            self.target_classes = [int(c.strip()) for c in classes_env.split(",")]

    @property
    def is_rtsp(self) -> bool:
        """True se la sorgente e uno stream RTSP."""
        return self.video_source.lower().startswith("rtsp://")
```

### Flusso
File `.env` → `os.getenv()` → attributi della dataclass → usati da tutti i moduli

### Dipendenze
- `os` e `pathlib` (standard library)
- `python-dotenv` per caricare `.env`

### Concetti chiave

**`@dataclass`** e un decoratore Python che crea automaticamente `__init__`, `__repr__`, ecc. per una classe che contiene solo dati. Invece di scrivere manualmente il costruttore, basta dichiarare gli attributi con i loro tipi.

**`__post_init__`** viene chiamato automaticamente *dopo* `__init__`. Qui lo usiamo per convertire la stringa `"0,2,7"` in una lista `[0, 2, 7]`.

**`@property`** trasforma un metodo in un attributo in sola lettura. `config.is_rtsp` sembra un attributo ma in realta esegue una funzione.

**`list[int] | None`** e un *union type* (Python 3.10+): il valore puo essere una lista di interi OPPURE `None`.

**`os.getenv("CHIAVE", "default")`** legge una variabile d'ambiente. Se non esiste, usa il valore di default.

---

## 2.5 `video_analyzer/src/video_source.py` — Sorgente Video

**Percorso:** `video_analyzer/src/video_source.py` (106 righe)

### Scopo
Astrae la sorgente video: che sia un file MP4 o uno stream RTSP, il resto del sistema riceve sempre un frame numpy.

### Ruolo nell'architettura
E il **primo anello** della pipeline. Fornisce i frame al Detector.

### Sezioni principali del codice

**Connessione:**
```python
def _connect(self) -> bool:
    if self.config.is_rtsp:
        self.cap = cv2.VideoCapture(source, cv2.CAP_FFMPEG)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    else:
        self.cap = cv2.VideoCapture(source)
```
- Per RTSP usa il backend FFMPEG con buffer minimo (1 frame). Un buffer grande causerebbe ritardo nello stream.

**Lettura frame:**
```python
def read_frame(self) -> np.ndarray | None:
    ret, frame = self.cap.read()
    if not ret:
        if self.config.is_rtsp:
            return self._reconnect()  # Riprova
        else:
            return None  # Fine del file
    # Ridimensiona se necessario
    if w != target_w or h != target_h:
        frame = cv2.resize(frame, (target_w, target_h))
    return frame
```

**Riconnessione RTSP:**
```python
def _reconnect(self) -> np.ndarray | None:
    self.release()
    time.sleep(delay)
    if self._connect():
        return self.read_frame()
    return None
```

### Flusso
Sorgente RTSP/MP4 → `cv2.VideoCapture` → `read_frame()` → frame numpy BGR 1280x720

### Concetti chiave

**OpenCV `VideoCapture`** e la classe che sa leggere video da qualsiasi sorgente: file, webcam, stream RTSP.

**RTSP (Real-Time Streaming Protocol)** e un protocollo per lo streaming video in tempo reale. Le telecamere IP lo usano per trasmettere il loro flusso video.

**Frame numpy** — un'immagine e rappresentata come un array numpy 3D: `(altezza, larghezza, canali)`. Un frame 1280x720 a colori BGR e un array di forma `(720, 1280, 3)`.

**Pattern di riconnessione** — per stream live, la connessione puo cadere. Il sistema attende N secondi, poi riprova. Questo lo rende *resiliente* ai problemi di rete.

---

## 2.6 `video_analyzer/src/detector.py` — Rilevamento e Tracking AI

**Percorso:** `video_analyzer/src/detector.py` (202 righe)

### Scopo
Esegue il rilevamento oggetti con YOLOv8 e il tracking con ByteTrack per assegnare ID persistenti.

### Ruolo nell'architettura
E il **cervello AI** del sistema. Trasforma un frame grezzo in una lista di detection strutturate.

### Sezioni principali del codice

**Dataclass Detection:**
```python
@dataclass
class Detection:
    track_id: int          # ID tracking persistente (-1 se non tracciato)
    class_id: int          # Indice classe COCO/custom
    class_name: str        # Nome classe leggibile
    confidence: float      # Confidenza 0.0 - 1.0
    bbox: tuple[int, int, int, int]  # (x1, y1, x2, y2) in pixel
    center: tuple[int, int]          # Centro bounding box
    bottom_center: tuple[int, int]   # Punto basso-centro
```

**Detection + Tracking:**
```python
def detect_and_track(self, frame: np.ndarray) -> list[Detection]:
    results = self.model.track(
        source=frame,
        persist=True,           # Mantieni tracking tra frame
        conf=self.config.yolo_confidence,
        device=self.config.yolo_device,
        tracker=self.config.tracker_type,
        classes=self.config.target_classes,
        verbose=False,
    )

    # Estrai coordinate
    x1, y1, x2, y2 = boxes.xyxy[i].cpu().numpy().astype(int)
    class_id = int(boxes.cls[i].cpu().numpy())
    confidence = float(boxes.conf[i].cpu().numpy())
    track_id = int(boxes.id[i].cpu().numpy())
```

### Flusso
Frame BGR numpy → `model.track()` → tensori GPU → `.cpu().numpy()` → lista `Detection`

### Concetti chiave

**YOLO (You Only Look Once)** e un algoritmo di *object detection* in tempo reale. Guarda l'intera immagine in un colpo solo e rileva tutti gli oggetti visibili, insieme alla loro posizione (bounding box) e alla probabilita che siano quello che pensa (confidence).

**Bounding Box** e il rettangolo che circonda un oggetto rilevato. `(x1, y1, x2, y2)` sono le coordinate dell'angolo in alto a sinistra e in basso a destra.

**Confidence** e un numero da 0.0 a 1.0 che indica quanto l'AI e "sicura" del rilevamento. Con `confidence=0.4`, ignoriamo tutto sotto il 40%.

**ByteTrack** e un algoritmo di *tracking*: assegna un ID persistente a ogni oggetto tra frame successivi. Se YOLO vede un muletto nel frame 1 e nel frame 2, ByteTrack capisce che e lo stesso muletto e gli assegna lo stesso `track_id`.

**`persist=True`** dice a ByteTrack di mantenere la memoria tra le chiamate. Senza questo, ogni frame partirebbe da zero.

**`.cpu().numpy()`** — YOLO restituisce i risultati come *tensori PyTorch* sulla GPU. Per usarli in Python normale, li copiamo sulla CPU (`.cpu()`) e li convertiamo in array numpy (`.numpy()`).

---

## 2.7 `video_analyzer/src/reference_point.py` — Strategia Punto di Riferimento

**Percorso:** `video_analyzer/src/reference_point.py` (45 righe)

### Scopo
Calcola il punto di riferimento spaziale dal bounding box. Questo punto determina quando un oggetto e "dentro" o "fuori" da una ROI.

### Sezioni principali del codice

```python
class ReferencePoint(Enum):
    BOTTOM_CENTER = "bottom_center"   # Base dell'oggetto (default)
    CENTROID = "centroid"             # Centro geometrico
    TOP_CENTER = "top_center"         # Punto piu alto

def compute_reference_point(bbox, strategy=ReferencePoint.BOTTOM_CENTER):
    x1, y1, x2, y2 = bbox
    cx = (x1 + x2) / 2.0

    if strategy == ReferencePoint.BOTTOM_CENTER:
        return (cx, float(y2))
    elif strategy == ReferencePoint.CENTROID:
        cy = (y1 + y2) / 2.0
        return (cx, cy)
    elif strategy == ReferencePoint.TOP_CENTER:
        return (cx, float(y1))
```

### Perche BOTTOM_CENTER e il default?

Immagina una telecamera che guarda un magazzino dall'alto con un'angolazione. Il punto in basso al centro del bounding box corrisponde approssimativamente ai "piedi" del muletto — la posizione reale sul pavimento. Il centro geometrico o il punto alto sarebbero fuorvianti perche influenzati dalla prospettiva.

### Concetti chiave

**Enum** (enumerazione) e un tipo Python che definisce un insieme fisso di costanti con nome. Invece di usare stringhe arbitrarie come `"bottom_center"`, usiamo `ReferencePoint.BOTTOM_CENTER` — il codice e piu sicuro e l'IDE puo suggerire i valori.

**Strategy Pattern** — la scelta dell'algoritmo (quale punto calcolare) e *configurabile*, non hardcoded. Ogni ROI puo usare una strategia diversa. Questo e un pattern di design classico.

---

## 2.8 `video_analyzer/src/roi_engine.py` — Motore Geometrico ROI

**Percorso:** `video_analyzer/src/roi_engine.py` (518 righe) — **il file piu complesso del progetto**

### Scopo
Verifica se gli oggetti rilevati sono dentro o fuori dalle zone ROI, gestisce le transizioni (ingresso/uscita/sosta) e genera eventi.

### Ruolo nell'architettura
E la **logica di business** centrale: trasforma i rilevamenti AI grezzi in eventi significativi per il business ("il muletto 5 e entrato nella corsia A-01").

### Sezioni principali del codice

**1. Dataclass ROIDefinition — Definizione geometrica:**
```python
@dataclass
class ROIDefinition:
    id: str
    name: str
    points: list[tuple[float, float]]
    reference_point: ReferencePoint = ReferencePoint.BOTTOM_CENTER

    def __post_init__(self) -> None:
        if len(self.points) < 3:
            raise ValueError(f"Servono almeno 3 punti")
        self._polygon = Polygon(self.points)
        if not self._polygon.is_valid:
            self._polygon = self._polygon.buffer(0)  # Correggi poligono
```
- Crea un oggetto `Polygon` Shapely dai punti
- Se il poligono e "non valido" (es. bordi che si incrociano), `buffer(0)` lo corregge

**2. Dataclass TrackState — Stato ingresso/uscita:**
```python
@dataclass
class TrackState:
    track_id: int
    roi_id: str
    is_inside: bool = False
    entered_at: Optional[float] = None    # Quando e entrato

    @property
    def dwell_seconds(self) -> float:
        if self.entered_at is None:
            return 0.0
        return time.monotonic() - self.entered_at
```
- Tiene traccia dello stato di ogni coppia (muletto, zona)
- `dwell_seconds` calcola da quanto tempo il muletto e nella zona

**3. Metodo `process_detections` — La macchina a stati (CUORE DEL SISTEMA):**
```python
def process_detections(self, detections: list[Detection]) -> list[ROIEvent]:
    for det in detections:
        if det.track_id < 0:
            continue  # Ignora detection senza tracking

        for roi in self.active_rois:
            ref_point = compute_reference_point(det.bbox, roi.reference_point)
            point = Point(ref_point)
            is_inside = roi.polygon.contains(point)
            state = self._get_state(det.track_id, roi.id)

            if is_inside and not state.is_inside:
                # === INGRESSO nella ROI ===
                # Genera evento "roi_enter"

            elif is_inside and state.is_inside:
                # === PERMANENZA nella ROI ===
                # Controlla soglia dwell time

            elif not is_inside and state.is_inside:
                # === USCITA dalla ROI ===
                # Genera evento "roi_exit" con dwell_seconds
```

La logica e una **macchina a stati** con 2 stati (`fuori` e `dentro`) e 3 transizioni:

```
          ENTER             DWELL (soglia superata)
FUORI ----------> DENTRO -----------------------> evento dwell_time
  ^                 |
  |    EXIT         |
  +-----------------+
```

**4. Gestione tracker persi:**
```python
def _handle_lost_tracks(self, seen_track_ids, now_epoch):
    for key, state in self._track_states.items():
        if not state.is_inside:
            continue
        if state.track_id in seen_track_ids:
            continue
        # Tolleranza 1 secondo prima di dichiarare uscita
        if (now - state.last_seen_at) < 1.0:
            continue
        # Track perso -> genera exit
```
- Se un muletto era dentro una ROI ma non viene piu rilevato per piu di 1 secondo, viene considerato uscito
- La tolleranza di 1 secondo evita falsi exit per frame drop temporanei

### Flusso
`list[Detection]` → per ogni detection, per ogni ROI: calcola punto → check contains → aggiorna stato → genera `list[ROIEvent]`

### Dipendenze
- `shapely.geometry.Point` e `Polygon` — geometria computazionale
- `detector.Detection` — struttura dati del rilevamento
- `reference_point.compute_reference_point` — calcolo punto

### Concetti chiave

**Macchina a stati (State Machine)** e un modello dove un sistema puo trovarsi in uno stato tra un insieme finito, con transizioni definite. Qui ogni coppia track_id/roi_id ha lo stato `fuori` o `dentro`.

**Point-in-Polygon** e un algoritmo geometrico fondamentale: dato un punto e un poligono, determina se il punto e dentro o fuori. Shapely lo implementa con `polygon.contains(point)`.

**`time.monotonic()`** e un orologio che NON torna mai indietro (a differenza di `time.time()` che puo cambiare se l'utente modifica l'orologio di sistema). Ideale per misurare durate.

**Dwell Time** e il tempo di permanenza in una zona. Esempio: "il muletto 5 e rimasto nella corsia A-01 per 12.3 secondi".

---

## 2.9 `video_analyzer/src/event_manager.py` — Pubblicazione MQTT

**Percorso:** `video_analyzer/src/event_manager.py` (216 righe)

### Scopo
Converte gli eventi ROI in messaggi JSON e li pubblica sul broker MQTT.

### Ruolo nell'architettura
E il **ponte** tra il Video Analyzer e il resto del sistema. Senza questo modulo, gli eventi esisterebbero solo nei log locali.

### Sezioni principali del codice

**Connessione:**
```python
def connect(self) -> bool:
    self._client = mqtt.Client(
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        client_id=f"video_analyzer_{self.config.camera_id}",
        protocol=mqtt.MQTTv5,
    )
    self._client.on_connect = self._on_connect
    self._client.on_disconnect = self._on_disconnect
    self._client.loop_start()  # Thread separato per gestire la rete

    # Attendi connessione (max 5 secondi)
    while not self._connected and (time.monotonic() - start) < 5.0:
        time.sleep(0.1)
```

**Pubblicazione:**
```python
def publish_event(self, event: ROIEvent) -> bool:
    payload = self._event_to_payload(event)
    payload_json = json.dumps(payload, ensure_ascii=False)
    result = self._client.publish(
        topic=self.config.mqtt_topic,
        payload=payload_json,
        qos=1,  # At least once delivery
    )
```

**Serializzazione (conversione in JSON):**
```python
@staticmethod
def _event_to_payload(event: ROIEvent) -> dict:
    return {
        "schema_version": "1.0",
        "timestamp": datetime.fromtimestamp(event.timestamp, tz=timezone.utc).isoformat(),
        "event_type": str(event.event_type),
        "track_id": int(event.track_id),      # Conversione numpy → int nativo
        "confidence": float(round(event.confidence, 3)),
        "bbox": [int(x) for x in event.bbox], # Conversione numpy → list[int]
        # ... altri campi
    }
```

### Flusso
`ROIEvent` → `_event_to_payload()` → dict Python → `json.dumps()` → stringa JSON → `publish()` → broker MQTT

### Concetti chiave

**`loop_start()`** avvia un thread separato che gestisce la comunicazione di rete MQTT. Il thread principale continua a processare video. Se usassimo `loop_forever()`, il programma si bloccherebbe in attesa di messaggi.

**QoS 1 (at-least-once)** — il client ritrasmette il messaggio finche non riceve conferma dal broker. Il messaggio potrebbe arrivare piu di una volta, ma non si perde mai.

**Schema versioning** — il campo `schema_version: "1.0"` permette al backend di sapere come interpretare il messaggio. Se in futuro cambiamo il formato, incrementiamo la versione e il backend puo gestire entrambi.

**Conversione tipi numpy** — YOLO restituisce `numpy.int64` e `numpy.float64`, che `json.dumps()` non sa serializzare. Il metodo converte esplicitamente tutto in tipi Python nativi (`int()`, `float()`).

**Graceful degradation** — se MQTT e offline, l'EventManager logga un warning ma non crasha. Il Video Analyzer continua a rilevare.

---

## 2.10 `video_analyzer/src/main.py` — Entry Point Pipeline

**Percorso:** `video_analyzer/src/main.py` (208 righe)

### Scopo
Orchestra l'intera pipeline del Video Analyzer: inizializza tutti i componenti ed esegue il loop principale.

### Ruolo nell'architettura
E il **direttore d'orchestra** del Video Analyzer. Ogni componente viene creato, configurato e coordinato qui.

### Sezioni principali del codice

**1. Gestione segnali (shutdown pulito):**
```python
_shutdown = False

def signal_handler(sig, frame):
    global _shutdown
    _shutdown = True

signal.signal(signal.SIGINT, signal_handler)   # CTRL+C
signal.signal(signal.SIGTERM, signal_handler)  # docker stop
```

**2. Inizializzazione (fase per fase):**
```python
def main():
    config = VideoAnalyzerConfig()
    video = VideoSource(config)
    detector = Detector(config)
    roi_engine = ROIEngine()
    roi_engine.load_from_file(config.roi_file)
    event_manager = EventManager(config)
    event_manager.connect()
```

**3. Loop principale:**
```python
    while not _shutdown:
        frame = video.read_frame()
        if frame is None:
            break

        detections = detector.detect_and_track(frame)
        events = roi_engine.process_detections(detections)

        if events:
            event_manager.publish_events(events)

        # Gestione tasti
        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"): break      # Esci
        elif key == ord("p"): cv2.waitKey(0)  # Pausa
        elif key == ord("r"): roi_engine.reset()  # Reset stati
```

**4. Cleanup (sempre eseguito):**
```python
    finally:
        event_manager.disconnect()
        video.release()
        cv2.destroyAllWindows()
```

### Flusso completo (un ciclo del loop)
1. `read_frame()` — legge un frame dalla camera
2. `detect_and_track(frame)` — YOLO rileva oggetti e ByteTrack li traccia
3. `process_detections(detections)` — verifica intersezioni con ROI, genera eventi
4. `publish_events(events)` — invia eventi su MQTT
5. Calcola FPS, disegna overlay, controlla tasti

### Concetti chiave

**Pipeline Pattern** — i dati fluiscono in sequenza attraverso componenti specializzati. Ogni componente fa una sola cosa e passa il risultato al successivo.

**Signal Handling** — `SIGINT` (CTRL+C) e `SIGTERM` (`docker stop`) permettono una chiusura pulita: il flag `_shutdown` viene impostato a `True` e il loop esce ordinatamente.

**`finally`** — il blocco finally viene eseguito SEMPRE, anche se c'e un'eccezione. Garantisce che le risorse vengano rilasciate (connessione MQTT chiusa, video liberato, finestre chiuse).

---

# PARTE 3 — Servizio Backend (FastAPI + PostgreSQL)

Il Backend ha una **doppia funzione**:
1. **Subscriber MQTT**: ascolta gli eventi dal Video Analyzer e li salva nel database
2. **Server REST API**: espone endpoint per il frontend per leggere eventi e gestire camere

---

## 3.1 `backend/Dockerfile` — Immagine Docker

**Percorso:** `backend/Dockerfile` (25 righe)

### Sezioni principali

```dockerfile
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ /app/src/

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```

- **`python:3.12-slim`** — immagine leggera con Python 3.12 (senza strumenti non necessari)
- **`libpq-dev`** — libreria C necessaria per il driver PostgreSQL (`asyncpg`)
- **`--reload`** — uvicorn riavvia automaticamente quando i file cambiano (solo per sviluppo)

---

## 3.2 `backend/requirements.txt` — Dipendenze Python

| Libreria | A cosa serve |
|----------|-------------|
| `fastapi>=0.115.0` | Framework web moderno per API REST asincrone |
| `uvicorn[standard]>=0.34.0` | Server ASGI per eseguire FastAPI |
| `sqlalchemy[asyncio]>=2.0.0` | ORM con supporto asincrono per il database |
| `asyncpg>=0.30.0` | Driver PostgreSQL ad alte prestazioni (asincrono) |
| `paho-mqtt>=2.1.0` | Client MQTT per sottoscrivere eventi |
| `pydantic>=2.9.0` | Validazione e serializzazione dati |
| `pydantic-settings>=2.6.0` | Gestione configurazione da environment |
| `python-dotenv>=1.0.0` | Caricamento file `.env` |

---

## 3.3 `backend/src/db/init.sql` — Schema Database

**Percorso:** `backend/src/db/init.sql` (76 righe)

### Scopo
Definisce la struttura del database: tabelle, colonne, chiavi, indici. Viene eseguito automaticamente da PostgreSQL al primo avvio.

### Le 4 tabelle

**1. `cameras` — Camere registrate:**
```sql
CREATE TABLE IF NOT EXISTS cameras (
    id          VARCHAR(50) PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    rtsp_url    VARCHAR(500),
    location    VARCHAR(200),
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

**2. `rois` — Zone ROI per camera:**
```sql
CREATE TABLE IF NOT EXISTS rois (
    id          SERIAL PRIMARY KEY,
    camera_id   VARCHAR(50) NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    aisle_id    VARCHAR(50) NOT NULL,
    points      JSONB NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

**3. `events` — Eventi rilevati:**
```sql
CREATE TABLE IF NOT EXISTS events (
    id              SERIAL PRIMARY KEY,
    timestamp       TIMESTAMPTZ NOT NULL,
    camera_id       VARCHAR(50) NOT NULL REFERENCES cameras(id),
    aisle_id        VARCHAR(50),
    event_type      VARCHAR(50) NOT NULL DEFAULT 'forklift_pallet',
    raw_data        JSONB,              -- Tutti i dati AI grezzi
    track_id        INTEGER,
    entered_at      TIMESTAMPTZ,
    exited_at       TIMESTAMPTZ,
    external_tag    VARCHAR(200),       -- Per matching WMS
    validated       BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

**4. `wms_tags` — Tag WMS per matching:**
```sql
CREATE TABLE IF NOT EXISTS wms_tags (
    id              SERIAL PRIMARY KEY,
    timestamp       TIMESTAMPTZ NOT NULL,
    tag_data        VARCHAR(500) NOT NULL,
    matched_event_id INTEGER REFERENCES events(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

**Indici per prestazioni:**
```sql
CREATE INDEX idx_events_timestamp ON events(timestamp);
CREATE INDEX idx_events_camera ON events(camera_id);
CREATE INDEX idx_events_validated ON events(validated);
```

### Concetti chiave

**DDL (Data Definition Language)** — i comandi SQL che definiscono la *struttura* del database (CREATE TABLE, CREATE INDEX), non i dati.

**`SERIAL`** — tipo PostgreSQL per numeri auto-incrementali (1, 2, 3, ...). Ogni nuovo record riceve un ID progressivo.

**`TIMESTAMPTZ`** — timestamp con timezone. I tempi sono sempre salvati in UTC — fondamentale per sistemi distribuiti.

**`JSONB`** — JSON binario di PostgreSQL. Piu veloce da interrogare del JSON testuale. Qui salva `raw_data` (dati AI grezzi) e `points` (coordinate ROI). Perfetto per dati flessibili che possono cambiare struttura.

**`REFERENCES ... ON DELETE CASCADE`** — chiave esterna con cancellazione a cascata. Se si elimina una camera, tutte le ROI associate vengono eliminate automaticamente.

**`CREATE INDEX`** — un indice e come l'indice di un libro: permette di trovare rapidamente i record senza scorrere tutta la tabella. Indispensabile per query frequenti.

**`ON CONFLICT DO NOTHING`** — nella INSERT della camera di esempio: se esiste gia, non fare nulla. Rende lo script *idempotente* (eseguibile piu volte senza errori).

---

## 3.4 `backend/src/db/database.py` — Connessione Database

**Percorso:** `backend/src/db/database.py` (70 righe)

### Scopo
Configura la connessione asincrona a PostgreSQL con pool di connessioni.

### Sezioni principali del codice

```python
# Engine asincrono con pool di connessioni
engine = create_async_engine(
    DATABASE_URL,
    echo=False,           # True per vedere le query SQL nel log
    pool_size=10,         # Connessioni mantenute pronte
    max_overflow=20,      # Connessioni extra temporanee
    pool_pre_ping=True,   # Verifica connessione prima di usarla
)

# Factory per creare sessioni
async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

# Classe base per tutti i modelli ORM
class Base(DeclarativeBase):
    pass

# Dependency Injection per FastAPI
async def get_session() -> AsyncSession:
    async with async_session() as session:
        yield session
```

### Concetti chiave

**Connection Pool** — invece di aprire una nuova connessione al database per ogni richiesta (lento), il pool ne mantiene 10 gia pronte. Quando serve, ne "presta" una e la "riprende" quando ha finito. `max_overflow=20` permette di creare fino a 20 connessioni extra nei momenti di picco.

**`pool_pre_ping=True`** — prima di usare una connessione dal pool, verifica che sia ancora attiva. Evita errori se PostgreSQL ha chiuso la connessione per inattivita.

**`async/await`** — le operazioni asincrone permettono al server di gestire altre richieste mentre aspetta la risposta dal database. Senza async, il server si bloccherebbe ad ogni query.

**Dependency Injection** — `get_session()` e un *async generator* che FastAPI chiama automaticamente quando un endpoint ha bisogno del database. L'endpoint lo dichiara con `session: AsyncSession = Depends(get_session)`. FastAPI si occupa di creare la sessione, passarla, e chiuderla dopo.

---

## 3.5 `backend/src/db/models.py` — Modelli ORM

**Percorso:** `backend/src/db/models.py` (87 righe)

### Scopo
Mappa le tabelle SQL su classi Python. Invece di scrivere query SQL a mano, interagiamo con oggetti.

### Sezioni principali del codice

```python
class Camera(Base):
    __tablename__ = "cameras"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    rtsp_url: Mapped[str | None] = mapped_column(String(500))

    # Relazioni: una camera ha molte ROI e molti eventi
    rois: Mapped[list["ROI"]] = relationship(
        back_populates="camera", cascade="all, delete-orphan"
    )
    events: Mapped[list["Event"]] = relationship(back_populates="camera")


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    camera_id: Mapped[str] = mapped_column(String(50), ForeignKey("cameras.id"))
    event_type: Mapped[str] = mapped_column(String(50), default="forklift_pallet")
    raw_data: Mapped[dict | None] = mapped_column(JSONB)

    camera: Mapped["Camera"] = relationship(back_populates="events")
```

### Concetti chiave

**ORM (Object-Relational Mapping)** — trasforma tabelle in classi e righe in oggetti. Invece di:
```sql
SELECT * FROM cameras WHERE id = 'CAM_01';
```
Scriviamo:
```python
result = await session.execute(select(Camera).where(Camera.id == 'CAM_01'))
camera = result.scalar_one_or_none()
print(camera.name)  # Accedo come attributo Python!
```

**`Mapped[str]`** — sintassi SQLAlchemy 2.0 per dichiarare il tipo di una colonna con type hints Python.

**`relationship`** — definisce una relazione tra tabelle. `Camera.rois` restituisce automaticamente tutte le ROI associate. `cascade="all, delete-orphan"` significa che eliminando una camera, le ROI vengono eliminate di conseguenza.

**`JSONB`** — il campo `raw_data` puo contenere qualsiasi struttura JSON. Questo e utile per dati AI che possono cambiare formato nel tempo.

---

## 3.6 `backend/src/models/schemas.py` — Schemi Pydantic

**Percorso:** `backend/src/models/schemas.py` (129 righe)

### Scopo
Definisce la struttura dei dati in ingresso (request) e in uscita (response) delle API. Valida automaticamente i dati.

### Sezioni principali del codice

**Pattern Base → Create → Response:**
```python
class CameraBase(BaseModel):
    id: str = Field(..., max_length=50, examples=["CAM_DEV_01"])
    name: str = Field(..., max_length=100)
    rtsp_url: Optional[str] = None
    is_active: bool = True

class CameraCreate(CameraBase):
    pass  # Stessi campi di Base (per POST)

class CameraResponse(CameraBase):
    created_at: datetime
    model_config = {"from_attributes": True}  # Converte da ORM
```

**Risposta paginata:**
```python
class EventListResponse(BaseModel):
    events: list[EventResponse]
    total: int        # Totale record nel DB
    page: int         # Pagina corrente
    page_size: int    # Record per pagina
```

**Schema payload MQTT:**
```python
class MQTTEventPayload(BaseModel):
    schema_version: str = "1.0"
    timestamp: datetime
    event_type: str
    track_id: int
    confidence: float
    bbox: list[int]
    dwell_seconds: float = 0.0
```

### Concetti chiave

**Pydantic** valida automaticamente i dati. Se qualcuno manda un `name` di 200 caratteri (max 100), Pydantic restituisce un errore 422 senza che lo sviluppatore scriva codice di validazione.

**Pattern DTO (Data Transfer Object):** `Base` contiene i campi comuni, `Create` e per le richieste di creazione (senza ID e timestamp), `Response` aggiunge i campi generati dal server (ID, created_at).

**`Field(...)`** — il `...` (Ellipsis) significa "campo obbligatorio". `max_length=50` imposta la lunghezza massima. `examples=["CAM_DEV_01"]` appare nella documentazione automatica di FastAPI.

**`from_attributes = True`** — permette a Pydantic di creare un Response direttamente da un oggetto ORM SQLAlchemy.

---

## 3.7 `backend/src/routers/events.py` — API Eventi

**Percorso:** `backend/src/routers/events.py` (142 righe)

### Scopo
Espone gli endpoint REST per interrogare gli eventi.

### 3 endpoint

**1. `GET /api/events` — Lista con filtri e paginazione:**
```python
@router.get("", response_model=EventListResponse)
async def list_events(
    camera_id: Optional[str] = Query(None),
    aisle_id: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    validated: Optional[bool] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
):
    query = select(Event)
    if camera_id:
        query = query.where(Event.camera_id == camera_id)
    # ... altri filtri

    offset = (page - 1) * page_size
    query = query.order_by(desc(Event.timestamp)).offset(offset).limit(page_size)
```

**2. `GET /api/events/{event_id}` — Dettaglio singolo:**
```python
@router.get("/{event_id}", response_model=EventResponse)
async def get_event(event_id: int, session = Depends(get_session)):
    event = result.scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Evento non trovato")
```

**3. `GET /api/events/stats/summary` — Statistiche aggregate:**
```python
@router.get("/stats/summary")
async def events_summary(session = Depends(get_session)):
    # Totale, per tipo, per camera, validati vs non validati
    total = await session.execute(select(func.count(Event.id)))
    by_type = select(Event.event_type, func.count(Event.id)).group_by(Event.event_type)
```

### Concetti chiave

**Paginazione server-side** — non si inviano MAI tutti i record al frontend. Si inviano 50 record alla volta con `offset` e `limit`. Il frontend naviga tra le pagine.

**Query builder dinamico** — i filtri vengono applicati solo se presenti. Se `camera_id` e `None`, il filtro non viene aggiunto alla query.

**HTTP Status Codes:**
- `200 OK` — risposta con successo (default)
- `404 Not Found` — risorsa non trovata
- `422 Unprocessable Entity` — validazione fallita (Pydantic)

---

## 3.8 `backend/src/routers/cameras.py` — API Camere (CRUD)

**Percorso:** `backend/src/routers/cameras.py` (107 righe)

### Scopo
Implementa le operazioni CRUD (Create, Read, Update, Delete) per le camere.

### I 5 endpoint

| Metodo | Path | Azione | Status Code |
|--------|------|--------|-------------|
| GET | `/api/cameras` | Lista tutte | 200 |
| GET | `/api/cameras/{id}` | Dettaglio una | 200 / 404 |
| POST | `/api/cameras` | Crea nuova | 201 / 409 |
| PUT | `/api/cameras/{id}` | Aggiorna | 200 / 404 |
| DELETE | `/api/cameras/{id}` | Elimina | 204 / 404 |

**Esempio — Creazione con verifica duplicato:**
```python
@router.post("", response_model=CameraResponse, status_code=201)
async def create_camera(data: CameraCreate, session = Depends(get_session)):
    # Verifica che non esista gia
    existing = await session.execute(select(Camera).where(Camera.id == data.id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Camera '{data.id}' gia esistente")

    camera = Camera(**data.model_dump())  # Converte Pydantic → ORM
    session.add(camera)
    await session.commit()
    await session.refresh(camera)  # Ricarica con i valori generati dal server
```

### Concetti chiave

**CRUD** — le 4 operazioni fondamentali sui dati, mappate sui metodi HTTP:
- **C**reate → POST (crea una nuova risorsa)
- **R**ead → GET (leggi una risorsa)
- **U**pdate → PUT (aggiorna una risorsa)
- **D**elete → DELETE (elimina una risorsa)

**Status code 201 Created** — indica che una nuova risorsa e stata creata (non un generico 200).

**Status code 409 Conflict** — indica che la richiesta confligge con lo stato attuale (duplicato).

**Status code 204 No Content** — operazione riuscita, ma nessun contenuto da restituire (usato per DELETE).

---

## 3.9 `backend/src/services/mqtt_listener.py` — Bridge MQTT → PostgreSQL

**Percorso:** `backend/src/services/mqtt_listener.py` (214 righe) — **file complesso**

### Scopo
Ascolta i messaggi MQTT dal Video Analyzer e li salva nel database PostgreSQL.

### Ruolo nell'architettura
E il **ponte** tra la comunicazione asincrona MQTT e la persistenza relazionale SQL.

### La sfida tecnica: threading + asyncio

Il client MQTT (`paho-mqtt`) usa un **thread separato** per ricevere messaggi. Ma SQLAlchemy e FastAPI usano **asyncio** (single-threaded). Il problema: come passare dati in modo sicuro tra i due mondi?

**Soluzione: asyncio.Queue + call_soon_threadsafe**

```
Thread MQTT (paho)          Thread principale (asyncio)
      |                              |
  _on_message()                 _persist_loop()
      |                              |
      +-- call_soon_threadsafe -----> Queue.put()
                                     |
                                Queue.get() --> INSERT nel DB
```

### Sezioni principali del codice

**Start:**
```python
async def start(self):
    self._running = True
    self._loop = asyncio.get_running_loop()  # Salva il loop corrente

    # Task che consuma dalla coda e scrive nel DB
    self._persist_task = asyncio.create_task(self._persist_loop())

    # Client MQTT in un thread separato
    self._client = mqtt.Client(protocol=mqtt.MQTTv5)
    self._client.on_message = self._on_message
    self._client.connect(self._broker, self._port)
    self._client.loop_start()  # Thread separato
```

**Ricezione messaggi (thread MQTT):**
```python
def _on_message(self, client, userdata, msg):
    payload = json.loads(msg.payload.decode("utf-8"))
    # Thread-safe: metti nella coda dell'asyncio loop
    self._loop.call_soon_threadsafe(self._event_queue.put_nowait, payload)
```

**Persistenza asincrona (thread principale):**
```python
async def _persist_loop(self):
    while self._running:
        try:
            payload = await asyncio.wait_for(self._event_queue.get(), timeout=1.0)
        except asyncio.TimeoutError:
            continue  # Controlla _running ogni secondo
        await self._persist_event(payload)
```

**Shutdown con svuotamento coda:**
```python
async def stop(self):
    self._running = False
    self._client.loop_stop()
    self._persist_task.cancel()
    try:
        await self._persist_task
    except asyncio.CancelledError:
        pass  # Svuota la coda prima di uscire
```

### Flusso
Messaggio MQTT → `_on_message` (thread paho) → `call_soon_threadsafe` → `asyncio.Queue` → `_persist_loop` → `_persist_event` → INSERT SQL → PostgreSQL

### Concetti chiave

**Producer-Consumer pattern** — il callback MQTT e il *producer* (produce dati), il loop di persistenza e il *consumer* (consuma dati). La coda e il buffer tra i due.

**`call_soon_threadsafe()`** — e l'unico modo sicuro per passare dati da un thread esterno all'event loop di asyncio. Senza questo, si avrebbero race condition (bug difficili da trovare).

**`asyncio.wait_for(... timeout=1.0)`** — aspetta un messaggio dalla coda per massimo 1 secondo. Se non arriva nulla, controlla `_running` e ricomincia. Questo permette lo shutdown pulito.

**Graceful shutdown** — quando il sistema si spegne, prima di uscire il loop svuota tutti i messaggi rimasti nella coda, cosi nessun evento va perso.

---

## 3.10 `backend/src/main.py` — Entry Point FastAPI

**Percorso:** `backend/src/main.py` (89 righe)

### Scopo
Entry point del backend: configura FastAPI, gestisce avvio/shutdown, registra i router.

### Sezioni principali del codice

**Lifespan (ciclo di vita):**
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- STARTUP ---
    await init_db()           # Verifica connessione database
    await mqtt_listener.start()  # Avvia listener MQTT
    logger.info("Backend avviato.")

    yield  # L'applicazione gira qui

    # --- SHUTDOWN ---
    await mqtt_listener.stop()
    await close_db()
```

**App FastAPI:**
```python
app = FastAPI(
    title="LogisticsTrack API",
    version="0.2.0",
    lifespan=lifespan,
)

# CORS per frontend dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registra i router
app.include_router(events.router)
app.include_router(cameras.router)

# Health check
@app.get("/health")
async def health_check():
    return {"status": "ok", "mqtt_connected": mqtt_listener._connected}
```

### Concetti chiave

**Lifespan** — sostituisce i vecchi decoratori `@app.on_event("startup")` e `@app.on_event("shutdown")`. Usa un *async context manager*: il codice prima di `yield` viene eseguito all'avvio, dopo di `yield` allo shutdown.

**CORS (Cross-Origin Resource Sharing)** — i browser bloccano le richieste da un'origine diversa (es. `localhost:5173` → `localhost:8000`). Il middleware CORS dice al browser: "le richieste da queste origini sono consentite".

**Health check** — l'endpoint `/health` restituisce lo stato del sistema. Il frontend lo chiama ogni 15 secondi per mostrare gli indicatori verde/rosso nell'header.

---

# PARTE 4 — Servizio Frontend (React + Vite + Tailwind)

Il frontend e una **SPA (Single Page Application)** che mostra la dashboard, gli eventi e le camere. Usa un tema scuro ed e responsive (si adatta a desktop, tablet e smartphone).

---

## 4.1 `frontend/Dockerfile` — Immagine Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
```

- **`node:20-alpine`** — immagine leggera con Node.js 20
- **`npm ci`** — installa le dipendenze in modo *deterministico* dal lock file (piu veloce e affidabile di `npm install`)
- **`--host 0.0.0.0`** — rende il server accessibile dalla rete Docker (non solo da localhost)

---

## 4.2 `frontend/vite.config.js` — Configurazione Build Tool

**Percorso:** `frontend/vite.config.js` (25 righe)

```javascript
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/health': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
```

### Concetti chiave

**Vite** e un build tool moderno (successore di Webpack). Compila JSX, CSS e moduli in file che il browser puo eseguire.

**Dev Proxy** — quando il frontend chiama `/api/events`, Vite inoltra la richiesta a `http://localhost:8000/api/events`. Cosi il frontend pensa di parlare con se stesso (niente problemi CORS in sviluppo).

**HMR (Hot Module Replacement)** — quando modifichi un file React, Vite aggiorna SOLO quel componente nella pagina senza ricaricarla tutta. Si vedono le modifiche istantaneamente.

---

## 4.3 `frontend/src/main.jsx` — Bootstrap React

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>,
)
```

- **`createRoot`** — API di React 19 per montare l'app nel DOM
- **`StrictMode`** — attiva controlli extra in sviluppo (avvisa di pratiche deprecate)
- **`document.getElementById('root')`** — trova il `<div id="root">` nell'HTML e ci monta React

---

## 4.4 `frontend/src/App.jsx` — Root Component con Routing

```jsx
export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/events" element={<Events />} />
            <Route path="/cameras" element={<Cameras />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
```

### Concetti chiave

**Provider Pattern** — `AuthProvider` avvolge tutta l'app e rende lo stato dell'utente disponibile ovunque, senza passare props manualmente.

**Client-side Routing** — `BrowserRouter` gestisce la navigazione senza ricaricare la pagina. Quando clicchi "Eventi", React sostituisce il componente nella pagina istantaneamente.

**Nested Routes** — `AppLayout` e il layout padre (sidebar + header), le pagine sono figli che vengono renderizzati dentro `<Outlet />`.

---

## 4.5 `frontend/src/contexts/AuthContext.jsx` — Gestione Autenticazione

```jsx
export function AuthProvider({ children }) {
  const [user] = useState({ name: 'Admin', role: 'admin' });

  const value = useMemo(() => ({
    user,
    role: user.role,
    isAdmin: user.role === 'admin',
    isAuthenticated: true,
  }), [user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve essere usato dentro AuthProvider');
  return context;
}
```

Attualmente e **simulato** (sempre admin). In futuro: autenticazione JWT reale.

### Concetti chiave

**React Context** — permette di condividere dati tra componenti senza passare props a ogni livello (evita il *prop drilling*).

**Custom Hook** — `useAuth()` e un hook personalizzato che semplifica l'accesso al contesto. I componenti scrivono `const { isAdmin } = useAuth()` invece di `useContext(AuthContext)`.

**`useMemo`** — memorizza il valore calcolato e lo ricalcola solo se `user` cambia. Evita re-render inutili dei componenti figli.

---

## 4.6 `frontend/src/config/navigation.js` — Configurazione Navigazione

```javascript
export const navigationItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'user'] },
  { path: '/events', label: 'Eventi', icon: CalendarClock, roles: ['admin', 'user'] },
  { path: '/cameras', label: 'Camere', icon: Camera, roles: ['admin'] },
  { path: '/settings', label: 'Impostazioni', icon: Settings, roles: ['admin'] },
];

export function getNavigationForRole(role) {
  return navigationItems.filter((item) => item.roles.includes(role));
}
```

**Navigazione data-driven:** le voci di menu sono dati, non codice. Per aggiungere una voce, basta aggiungere un oggetto all'array. Il componente Sidebar legge questo array e si aggiorna automaticamente.

---

## 4.7 `frontend/src/config/eventColumns.js` — Colonne Tabella e Filtri

**Percorso:** `frontend/src/config/eventColumns.js` (181 righe)

### Scopo
Definisce le 9 colonne della tabella eventi e i 7 filtri disponibili, **senza toccare il componente DataTable**.

### Esempio di colonna con rendering custom

```javascript
{
  key: 'event_type',
  label: 'Tipo',
  render: (value) => {
    const labels = { roi_enter: 'Ingresso', roi_exit: 'Uscita', dwell_time: 'Sosta' };
    const colors = { roi_enter: 'bg-green-500/20 text-green-400', /* ... */ };
    return `<span class="px-2 py-0.5 rounded text-xs ${color}">${label}</span>`;
  },
  isHtml: true,
}
```

### Concetti chiave

**Data-driven UI** — la configurazione della tabella e separata dal componente. Aggiungere una colonna = aggiungere un oggetto all'array, senza modificare `DataTable.jsx`. Questo e un pattern molto potente per UI complesse.

**Render functions** — ogni colonna puo avere una funzione `render` che trasforma il valore grezzo in HTML formattato (es. badge colorato per il tipo evento, colore per la confidence).

---

## 4.8 `frontend/src/services/api.js` — Client HTTP Centralizzato

**Percorso:** `frontend/src/services/api.js` (115 righe)

### Scopo
Tutte le chiamate HTTP al backend passano da qui. Gestione errori uniforme.

```javascript
async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Errore HTTP ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

// API pubbliche
export async function fetchEvents(params = {}) { /* ... */ }
export async function fetchCameras() { return request('/cameras'); }
export async function createCamera(data) { return request('/cameras', { method: 'POST', body: JSON.stringify(data) }); }
export async function deleteCamera(id) { return request(`/cameras/${id}`, { method: 'DELETE' }); }
```

### Concetti chiave

**Centralizzazione** — avere UN solo posto per le chiamate HTTP facilita la manutenzione. Se domani aggiungiamo autenticazione JWT, modifichiamo solo la funzione `request()`.

**`fetch API`** — API nativa del browser per le richieste HTTP. A differenza di librerie come Axios, non serve installare nulla.

---

## 4.9 `frontend/src/components/Layout/AppLayout.jsx` — Shell Principale

Layout della pagina con sidebar collapsabile, header e area contenuto. Responsive: sidebar fissa su desktop, overlay su mobile con backdrop semi-trasparente.

Usa `<Outlet />` di React Router per renderizzare la pagina corrente nell'area contenuto.

---

## 4.10 `frontend/src/components/Layout/Header.jsx` — Barra Superiore

Polling dello stato del sistema ogni 15 secondi tramite `/health`. Mostra icone colorate:
- **API**: Activity verde se il backend risponde, rosso altrimenti
- **MQTT**: Wifi verde se il broker e connesso, WifiOff rosso altrimenti

---

## 4.11 `frontend/src/components/Layout/Sidebar.jsx` — Navigazione Laterale

Sidebar fixed con logo, voci di navigazione filtrate per ruolo (`getNavigationForRole`), e toggle collapse/expand. `NavLink` di React Router evidenzia automaticamente la voce attiva.

---

## 4.12 `frontend/src/components/StatCard.jsx` — Card Statistica

Componente presentazionale semplice: mostra un'icona, un'etichetta e un numero grande. Mappa colori: blue, green, amber, red. Usato nella Dashboard per i totali.

---

## 4.13 `frontend/src/components/DataTable/DataTable.jsx` — Tabella Dati Generica

**Percorso:** `frontend/src/components/DataTable/DataTable.jsx` (130 righe)

Tabella **generica** guidata dalla configurazione colonne. 3 stati: caricamento (spinner), vuoto (messaggio), dati (righe). Supporta paginazione con navigazione prev/next.

Il componente non sa nulla degli "eventi" — e completamente riutilizzabile per qualsiasi tipo di dato.

---

## 4.14 `frontend/src/components/FilterPanel/FilterPanel.jsx` — Pannello Filtri

Genera filtri dinamicamente dalla configurazione. Tipi supportati: `select`, `text`, `number`, `datetime-local`. Grid responsive: 1 colonna su mobile, 4 su desktop grande.

---

## 4.15 `frontend/src/pages/Dashboard.jsx` — Pagina Dashboard

```javascript
const loadData = async () => {
  const [summaryData, eventsData] = await Promise.all([
    fetchEventsSummary(),
    fetchEvents({ page: 1, page_size: 10 }),
  ]);
};

useEffect(() => {
  loadData();
  const interval = setInterval(loadData, 30000); // Auto-refresh 30s
  return () => clearInterval(interval);
}, []);
```

- **`Promise.all`** — carica statistiche e ultimi eventi *in parallelo* (piu veloce)
- **Auto-refresh** — aggiorna ogni 30 secondi automaticamente
- Mostra 5 StatCard (totale, ingressi, uscite, soste, validati) e una tabella con gli ultimi 10 eventi

---

## 4.16 `frontend/src/pages/Events.jsx` — Pagina Eventi

Tabella completa con 7 filtri dinamici e paginazione server-side (25 record per pagina). Quando cambiano i filtri, la pagina torna a 1 automaticamente.

---

## 4.17 `frontend/src/pages/Cameras.jsx` — Pagina Camere

CRUD camere: lista come griglia di card, form toggle per creazione, eliminazione con conferma. Ogni card mostra nome, ID, URL RTSP, posizione e stato attivo/inattivo.

---

## 4.18 `frontend/src/pages/Settings.jsx` — Pagina Impostazioni

Placeholder con icona "lavori in corso". Liste le funzionalita previste: ROI Editor, parametri analisi, gestione utenti, configurazione WMS.

---

# PARTE 5 — Analisi Architetturale Finale

## 5.1 Pattern Architetturali Utilizzati

| # | Pattern | Dove | Descrizione |
|---|---------|------|-------------|
| 1 | **Microservizi** | Tutto il sistema | Ogni servizio e isolato in un container Docker |
| 2 | **Pipeline** | Video Analyzer | I dati fluiscono in sequenza: Source → Detector → ROI → MQTT |
| 3 | **Publish/Subscribe** | MQTT | Video Analyzer pubblica, Backend sottoscrive. Non si conoscono |
| 4 | **Producer-Consumer** | MQTT Listener | Callback produce, loop persiste. Coda come buffer |
| 5 | **MVC/Router** | Backend FastAPI | Modelli (models.py), validazione (schemas.py), logica (routers/) |
| 6 | **Dependency Injection** | FastAPI Depends | Sessioni DB iniettate automaticamente negli endpoint |
| 7 | **Component-Based** | React | UI composta da componenti riutilizzabili (StatCard, DataTable) |
| 8 | **Data-Driven UI** | Frontend config | Colonne e filtri definiti in array di configurazione |
| 9 | **Provider** | React Context | AuthProvider fornisce stato utente a tutti i componenti |
| 10 | **Strategy** | reference_point.py | Scelta punto riferimento configurabile per ROI |
| 11 | **State Machine** | roi_engine.py | Ogni coppia track/ROI ha stati con transizioni definite |
| 12 | **Graceful Degradation** | Tutto il sistema | Componente mancante → il resto continua a funzionare |

## 5.2 Flusso Dati Completo End-to-End

Cosa succede quando un muletto entra in una corsia, passo per passo:

1. **Camera RTSP** invia stream video continuo
2. **VideoSource** legge un frame (numpy BGR 1280x720)
3. **Detector** esegue YOLOv8 → rileva il muletto → ByteTrack assegna `track_id=5`
4. **ROIEngine** calcola il bottom_center → verifica se e dentro "Corsia A-01" → genera `roi_enter`
5. **EventManager** serializza in JSON → pubblica su MQTT `logistics/events` (QoS 1)
6. **Mosquitto** riceve e inoltra al subscriber
7. **MQTTListener** riceve nel thread paho → mette nella `asyncio.Queue`
8. **`_persist_loop`** preleva dalla coda → INSERT nella tabella `events`
9. **Frontend Dashboard** ogni 30s chiama `GET /api/events` → aggiorna tabella
10. **L'utente** vede "Ingresso — track #5 — Corsia A-01" nella dashboard

```
Camera → VideoSource → Detector → ROIEngine → EventManager
                                                    | MQTT
                                              Mosquitto
                                                    | MQTT
                                              MQTTListener → PostgreSQL
                                                                  | SQL
                                              FastAPI REST API <--+
                                                    | HTTP
                                              React Frontend → Utente
```

## 5.3 Resilienza e Graceful Degradation

| Scenario di guasto | Cosa succede |
|--------------------|-------------|
| **MQTT offline** | Video Analyzer continua a rilevare, eventi solo nel log |
| **Database offline** | Backend NON si avvia (fail-fast: meglio non partire che partire rotto) |
| **Frontend senza backend** | Indicatori rossi nell'header, tabelle vuote |
| **RTSP disconnesso** | VideoSource riprova ogni N secondi automaticamente |
| **Tracker perso (frame drop)** | ROI Engine attende 1s prima di generare exit |

## 5.4 Mappa Dipendenze tra File

**Video Analyzer:**
```
config.py           ← (nessuna dipendenza interna)
reference_point.py   ← (nessuna dipendenza interna)
video_source.py      ← config.py
detector.py          ← config.py
roi_engine.py        ← detector.py, reference_point.py
event_manager.py     ← config.py, roi_engine.py
main.py              ← TUTTI i moduli sopra
```

**Backend:**
```
db/database.py       ← (nessuna dipendenza interna)
db/models.py         ← db/database.py
models/schemas.py    ← (nessuna dipendenza interna)
routers/events.py    ← db/database.py, db/models.py, models/schemas.py
routers/cameras.py   ← db/database.py, db/models.py, models/schemas.py
services/mqtt_listener.py ← db/database.py, db/models.py
main.py              ← TUTTI i moduli sopra
```

**Frontend:**
```
services/api.js      ← (nessuna dipendenza interna)
contexts/AuthContext  ← (nessuna dipendenza interna)
config/navigation.js ← (nessuna dipendenza interna)
config/eventColumns  ← date-fns (libreria esterna)
hooks/useApi.js      ← (nessuna dipendenza interna)
components/*         ← api.js, AuthContext, navigation, eventColumns
pages/*              ← api.js, eventColumns, components/*
App.jsx              ← AuthContext, Layout, pages/*
main.jsx             ← App.jsx
```

## 5.5 Ordine di Studio Consigliato per Principianti

| Passo | File/Sezione | Perche |
|-------|-------------|--------|
| 1 | PARTE 0 — Introduzione | Capire il quadro generale |
| 2 | `docker-compose.yml` | Come i servizi si collegano |
| 3 | `mosquitto.conf` | Il broker MQTT (semplice) |
| 4 | `rois.json` | Dati di input (JSON semplice) |
| 5 | `config.py` | Come si configura un servizio Python |
| 6 | `video_source.py` | Acquisizione video (concetto intuitivo) |
| 7 | `detector.py` | Detection AI (affascinante, motivante) |
| 8 | `reference_point.py` | Helper geometrico (poche righe) |
| 9 | `roi_engine.py` | Il file piu complesso — prendere tempo |
| 10 | `event_manager.py` | Pubblicazione MQTT |
| 11 | `main.py` (video_analyzer) | Come tutto si assembla |
| 12 | `init.sql` | Schema database SQL |
| 13 | `database.py` | Connessione async al DB |
| 14 | `models.py` | Modelli ORM |
| 15 | `schemas.py` | Validazione dati Pydantic |
| 16 | `mqtt_listener.py` | Bridge MQTT→DB (avanzato) |
| 17 | `events.py` + `cameras.py` | API REST |
| 18 | `main.py` (backend) | Orchestrazione backend |
| 19 | `api.js` | Client HTTP frontend |
| 20 | `App.jsx` | Struttura React e routing |
| 21 | Componenti Layout | AppLayout, Header, Sidebar |
| 22 | Componenti UI | StatCard, DataTable, FilterPanel |
| 23 | Pagine | Dashboard, Events, Cameras |
| 24 | PARTE 5 | Visione d'insieme architetturale |

## 5.6 Glossario Tecnico

| Termine | Significato |
|---------|------------|
| **API** | Application Programming Interface — interfaccia per far comunicare software diversi |
| **ASGI** | Standard Python per server web asincroni (successore di WSGI) |
| **Async/Await** | Sintassi per operazioni asincrone — il programma non si blocca in attesa |
| **Bounding Box** | Rettangolo che circoscrive un oggetto rilevato nell'immagine |
| **ByteTrack** | Algoritmo di tracking che assegna ID persistenti tra frame |
| **Container** | Ambiente isolato per eseguire un'applicazione (come una VM leggera) |
| **CORS** | Meccanismo del browser che controlla quali siti possono chiamare un'API |
| **CRUD** | Create, Read, Update, Delete — le 4 operazioni base sui dati |
| **Dataclass** | Classe Python semplificata per contenere dati strutturati |
| **Dependency Injection** | Tecnica per fornire dipendenze dall'esterno |
| **Docker Compose** | Strumento per orchestrare piu container Docker |
| **Dwell Time** | Tempo di permanenza di un oggetto in una zona |
| **FastAPI** | Framework Python per creare API web veloci e asincrone |
| **GPU** | Processore grafico, usato per accelerare calcoli AI |
| **Hook (React)** | Funzione che aggiunge stato e logica ai componenti funzionali |
| **HMR** | Hot Module Replacement — aggiornamento codice senza reload |
| **JSONB** | JSON binario PostgreSQL (piu veloce da interrogare) |
| **JSX** | Sintassi che combina JavaScript e HTML (usata in React) |
| **MQTT** | Protocollo di messaggistica leggero basato su Publish/Subscribe |
| **ORM** | Object-Relational Mapping — mappa tabelle DB su classi Python |
| **Pydantic** | Libreria Python per validazione e serializzazione dati |
| **QoS** | Quality of Service — livello di garanzia consegna messaggi MQTT |
| **ROI** | Region of Interest — zona del frame video da monitorare |
| **RTSP** | Protocollo per streaming video in tempo reale |
| **SPA** | Single Page Application — app web che non ricarica la pagina |
| **SQLAlchemy** | ORM Python per database relazionali |
| **Tailwind CSS** | Framework CSS utility-first per styling rapido |
| **Tracking** | Seguire un oggetto tra frame consecutivi con un ID persistente |
| **Vite** | Build tool moderno per app web (piu veloce di Webpack) |
| **YOLO** | You Only Look Once — algoritmo di object detection in tempo reale |

---

*Guida generata dall'analisi di ~44 file del progetto LogisticsTrack.*
*Versione: 1.0 — Aggiornata a Fase 3 completata.*
