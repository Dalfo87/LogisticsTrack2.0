/**
 * LogisticsTrack — API Client
 * Client HTTP centralizzato. Tutte le chiamate API passano da qui.
 *
 * In dev: il proxy Vite inoltra /api → http://localhost:8000
 * In prod: nginx fa la stessa cosa
 */

const BASE = '/api';

/**
 * Fetch wrapper con gestione errori uniforme.
 */
async function request(path, options = {}) {
  const url = `${BASE}${path}`;

  const config = {
    headers: {
      'Content-Type': 'application/json',
      // Futuro: Authorization: `Bearer ${token}`
      ...options.headers,
    },
    ...options,
  };

  const response = await fetch(url, config);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Errore HTTP ${response.status}`);
  }

  // 204 No Content (es. DELETE)
  if (response.status === 204) return null;

  return response.json();
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export async function fetchHealth() {
  // health è fuori da /api
  const res = await fetch('/health');
  return res.json();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Lista eventi con filtri e paginazione.
 * @param {Object} params - Parametri query (camera_id, aisle_id, event_type, etc.)
 */
export async function fetchEvents(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.append(key, value);
    }
  });

  const queryStr = query.toString();
  return request(`/events${queryStr ? `?${queryStr}` : ''}`);
}

/**
 * Dettaglio singolo evento.
 */
export async function fetchEvent(eventId) {
  return request(`/events/${eventId}`);
}

/**
 * Statistiche riassuntive eventi.
 */
export async function fetchEventsSummary() {
  return request('/events/stats/summary');
}

// ---------------------------------------------------------------------------
// Cameras
// ---------------------------------------------------------------------------

export async function fetchCameras() {
  return request('/cameras');
}

export async function fetchCamera(cameraId) {
  return request(`/cameras/${cameraId}`);
}

export async function createCamera(data) {
  return request('/cameras', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateCamera(cameraId, data) {
  return request(`/cameras/${cameraId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteCamera(cameraId) {
  return request(`/cameras/${cameraId}`, {
    method: 'DELETE',
  });
}

/**
 * URL dello snapshot di una camera (immagine JPEG).
 * Non passa per request() perché restituisce un'immagine, non JSON.
 */
export function getCameraSnapshotUrl(cameraId) {
  return `${BASE}/cameras/${cameraId}/snapshot`;
}

// ---------------------------------------------------------------------------
// ROIs
// ---------------------------------------------------------------------------

/**
 * Lista ROI, con filtro opzionale per camera e/o modulo.
 * @param {string|null} cameraId   - Filtra per camera ID
 * @param {string|null} moduleType - Filtra per modulo ("logistics", "no_entry_filter", ...)
 */
export async function fetchROIs(cameraId = null, moduleType = null) {
  const params = new URLSearchParams();
  if (cameraId) params.append('camera_id', cameraId);
  if (moduleType) params.append('module_type', moduleType);
  const qs = params.toString();
  return request(`/rois${qs ? `?${qs}` : ''}`);
}

/**
 * Dettaglio singola ROI.
 */
export async function fetchROI(roiId) {
  return request(`/rois/${roiId}`);
}

/**
 * Crea una nuova ROI.
 */
export async function createROI(data) {
  return request('/rois', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Aggiorna una ROI esistente.
 */
export async function updateROI(roiId, data) {
  return request(`/rois/${roiId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/**
 * Elimina una ROI.
 */
export async function deleteROI(roiId) {
  return request(`/rois/${roiId}`, {
    method: 'DELETE',
  });
}

/**
 * Esporta le ROI di una camera verso il video analyzer.
 * Scrive rois.json e invia segnale MQTT di reload.
 */
export async function exportROIs(cameraId) {
  return request(`/rois/export/${cameraId}`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Camera Modules (schema v2.0)
// ---------------------------------------------------------------------------

/**
 * Recupera la configurazione moduli di una camera.
 * Risposta: {modules: [{type, enabled, config}, ...]}
 */
export async function fetchCameraModules(cameraId) {
  return request(`/cameras/${cameraId}/modules`);
}

/**
 * Aggiorna la configurazione moduli di una camera (solo in DB).
 * Per propagare al video analyzer usare exportCameraModules.
 * @param {string} cameraId
 * @param {Object} modulesConfig - {modules: [...]}
 */
export async function updateCameraModules(cameraId, modulesConfig) {
  return request(`/cameras/${cameraId}/modules`, {
    method: 'PUT',
    body: JSON.stringify(modulesConfig),
  });
}

/**
 * Esporta la configurazione moduli al video analyzer.
 * Scrive data/modules.json e invia segnale MQTT reload_modules.
 */
export async function exportCameraModules(cameraId) {
  return request(`/cameras/${cameraId}/modules/export`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Services (Docker container management)
// ---------------------------------------------------------------------------

/**
 * Lista lo stato di tutti i container Docker tracciati.
 */
export async function fetchServices() {
  return request('/services');
}

/**
 * Riavvia un container Docker specifico.
 * @param {string} serviceName - Nome logico del servizio (es. "video_analyzer")
 */
export async function restartService(serviceName) {
  return request(`/services/${serviceName}/restart`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Stream server (video_analyzer porta 8765, proxied via /video-stream)
// ---------------------------------------------------------------------------

const STREAM_BASE = '/video-stream';

/**
 * Recupera la configurazione runtime YOLO dallo stream server.
 */
export async function fetchStreamConfig() {
  const res = await fetch(`${STREAM_BASE}/config`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`Errore HTTP ${res.status}`);
  return res.json();
}

/**
 * Aggiorna la configurazione runtime YOLO (live, senza restart).
 * @param {Object} config - { confidence?, iou?, target_classes? }
 */
export async function updateStreamConfig(config) {
  const res = await fetch(`${STREAM_BASE}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Errore HTTP ${res.status}`);
  return res.json();
}

/**
 * Richiede il restart del loop di analisi video.
 * Usare insieme a restartService('video_analyzer') per restart completo del container.
 */
export async function requestStreamRestart() {
  const res = await fetch(`${STREAM_BASE}/restart`, {
    method: 'POST',
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Errore HTTP ${res.status}`);
  return res.json();
}
