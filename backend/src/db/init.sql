-- ============================================
-- LogisticsTrack — Schema Database
-- PostgreSQL 16
-- Versione: 2.0 (architettura multi-modulo)
-- ============================================

-- Tabella camere registrate
CREATE TABLE IF NOT EXISTS cameras (
    id              VARCHAR(50) PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    rtsp_url        VARCHAR(500),
    location        VARCHAR(200),
    is_active       BOOLEAN DEFAULT TRUE,
    -- Configurazione moduli attivi per questa camera (schema v2.0)
    -- Struttura: {"modules": [{"type": "logistics", "enabled": true, "config": {...}}]}
    modules_config  JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Tabella ROI (Region of Interest) per camera
CREATE TABLE IF NOT EXISTS rois (
    id          SERIAL PRIMARY KEY,
    camera_id   VARCHAR(50) NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    aisle_id    VARCHAR(50) NOT NULL,
    points      JSONB NOT NULL,            -- Array di [x, y] in pixel assoluti
    is_active   BOOLEAN DEFAULT TRUE,
    -- Modulo a cui appartiene questa ROI (schema v2.0)
    -- Valori: "logistics", "no_entry_filter" (o futuri moduli)
    module_type VARCHAR(50) NOT NULL DEFAULT 'logistics',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Tabella eventi rilevati dalla videoanalisi
CREATE TABLE IF NOT EXISTS events (
    id              SERIAL PRIMARY KEY,
    timestamp       TIMESTAMPTZ NOT NULL,
    camera_id       VARCHAR(50) NOT NULL,  -- Nessuna FK: eventi sopravvivono alla cancellazione camera
    aisle_id        VARCHAR(50),
    event_type      VARCHAR(50) NOT NULL DEFAULT 'forklift_pallet',

    -- Modulo che ha generato l'evento (schema v2.0)
    module_type     VARCHAR(50) NOT NULL DEFAULT 'logistics',

    -- Dati specifici del modulo (schema v2.0, ex raw_data)
    -- logistics:       {roi_id, roi_name, aisle_id, dwell_seconds, reference_point, label, confidence, bbox, crop_filename}
    -- no_entry_filter: {has_vest, upper_color, dwell_seconds, confidence, bbox, crop_filename}
    event_data      JSONB,

    -- Tracking: durata permanenza in ROI
    track_id        INTEGER,               -- ID tracker del muletto/persona
    entered_at      TIMESTAMPTZ,           -- Ingresso nella ROI
    exited_at       TIMESTAMPTZ,           -- Uscita dalla ROI

    -- Integrazione WMS
    external_tag    VARCHAR(200) DEFAULT NULL,
    matched_at      TIMESTAMPTZ DEFAULT NULL,
    validated       BOOLEAN DEFAULT FALSE,

    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Tabella tag WMS esterni (per matching)
CREATE TABLE IF NOT EXISTS wms_tags (
    id              SERIAL PRIMARY KEY,
    timestamp       TIMESTAMPTZ NOT NULL,
    tag_data        VARCHAR(500) NOT NULL,  -- Dato dal WMS o input manuale
    aisle_id        VARCHAR(50),
    matched_event_id INTEGER DEFAULT NULL REFERENCES events(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indici per query performanti
CREATE INDEX IF NOT EXISTS idx_events_timestamp    ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_camera       ON events(camera_id);
CREATE INDEX IF NOT EXISTS idx_events_aisle        ON events(aisle_id);
CREATE INDEX IF NOT EXISTS idx_events_validated    ON events(validated);
CREATE INDEX IF NOT EXISTS idx_events_track        ON events(track_id);
CREATE INDEX IF NOT EXISTS idx_events_module_type  ON events(module_type);
CREATE INDEX IF NOT EXISTS idx_wms_tags_timestamp  ON wms_tags(timestamp);
CREATE INDEX IF NOT EXISTS idx_wms_tags_matched    ON wms_tags(matched_event_id);
CREATE INDEX IF NOT EXISTS idx_rois_camera         ON rois(camera_id);
CREATE INDEX IF NOT EXISTS idx_rois_module_type    ON rois(module_type);

-- Camera di esempio per sviluppo
INSERT INTO cameras (id, name, rtsp_url, location)
VALUES ('CAM_DEV_01', 'Camera Sviluppo', 'rtsp://localhost:554/stream1', 'Magazzino Test')
ON CONFLICT (id) DO NOTHING;


-- ============================================
-- MIGRATION v1.0 → v2.0 (DB esistenti)
-- Eseguire manualmente su DB già inizializzati.
-- Sicuro: ogni ALTER usa IF NOT EXISTS / IF EXISTS.
-- ============================================

-- 1. Aggiunge modules_config a cameras
ALTER TABLE cameras
    ADD COLUMN IF NOT EXISTS modules_config JSONB DEFAULT '{}';

-- 2. Aggiunge module_type a rois
ALTER TABLE rois
    ADD COLUMN IF NOT EXISTS module_type VARCHAR(50) NOT NULL DEFAULT 'logistics';

-- 3. Aggiunge module_type a events
ALTER TABLE events
    ADD COLUMN IF NOT EXISTS module_type VARCHAR(50) NOT NULL DEFAULT 'logistics';

-- 4. Rinomina raw_data → event_data (solo se raw_data esiste ancora)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'events' AND column_name = 'raw_data'
    ) THEN
        ALTER TABLE events RENAME COLUMN raw_data TO event_data;
    END IF;
END $$;

-- 5. Indici aggiuntivi (IF NOT EXISTS già gestito sopra con CREATE INDEX IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_events_module_type ON events(module_type);
CREATE INDEX IF NOT EXISTS idx_rois_module_type   ON rois(module_type);
