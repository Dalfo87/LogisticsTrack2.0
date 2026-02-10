/**
 * LogisticsTrack — API Service
 * Chiamate centralizzate verso il backend FastAPI.
 * Implementazione completa in Fase 4.
 */

const API_BASE = '/api';

export async function fetchHealth() {
  const res = await fetch(`${API_BASE}/../health`);
  return res.json();
}

export async function fetchEvents(params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/events?${query}`);
  return res.json();
}
