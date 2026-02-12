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
