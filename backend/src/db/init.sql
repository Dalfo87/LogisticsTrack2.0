-- ============================================
-- LogisticsTrack — Schema Database Iniziale
-- PostgreSQL 16
-- ============================================

-- Tabella camere registrate
CREATE TABLE IF NOT EXISTS cameras (
    id          VARCHAR(50) PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    rtsp_url    VARCHAR(500),
    location    VARCHAR(200),
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Tabella ROI (Region of Interest) per camera
CREATE TABLE IF NOT EXISTS rois (
    id          SERIAL PRIMARY KEY,
    camera_id   VARCHAR(50) NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    aisle_id    VARCHAR(50) NOT NULL,
    points      JSONB NOT NULL,            -- Array di {x, y} normalizzati 0-1
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Tabella eventi rilevati dalla videoanalisi
CREATE TABLE IF NOT EXISTS events (
    id              SERIAL PRIMARY KEY,
    timestamp       TIMESTAMPTZ NOT NULL,
    camera_id       VARCHAR(50) NOT NULL REFERENCES cameras(id),
    aisle_id        VARCHAR(50),
    event_type      VARCHAR(50) NOT NULL DEFAULT 'forklift_pallet',

    -- Dati grezzi rilevamento AI (JSONB per flessibilità)
    raw_data        JSONB,
    -- Contiene: label, confidence, bbox, tracker_id, ref_point, ecc.

    -- Tracking: durata permanenza in ROI
    track_id        INTEGER,               -- ID tracker del muletto
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
CREATE INDEX idx_events_timestamp ON events(timestamp);
CREATE INDEX idx_events_camera ON events(camera_id);
CREATE INDEX idx_events_aisle ON events(aisle_id);
CREATE INDEX idx_events_validated ON events(validated);
CREATE INDEX idx_events_track ON events(track_id);
CREATE INDEX idx_wms_tags_timestamp ON wms_tags(timestamp);
CREATE INDEX idx_wms_tags_matched ON wms_tags(matched_event_id);
CREATE INDEX idx_rois_camera ON rois(camera_id);

-- Camera di esempio per sviluppo
INSERT INTO cameras (id, name, rtsp_url, location)
VALUES ('CAM_DEV_01', 'Camera Sviluppo', 'rtsp://localhost:554/stream1', 'Magazzino Test')
ON CONFLICT (id) DO NOTHING;
