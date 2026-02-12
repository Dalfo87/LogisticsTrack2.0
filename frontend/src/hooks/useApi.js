/**
 * LogisticsTrack — useApi Hook
 * Hook generico per chiamate API con gestione stato loading/error/data.
 */
import { useState, useEffect, useCallback } from 'react';

/**
 * @param {Function} apiFn - Funzione API da chiamare (es. fetchEvents)
 * @param {any} params - Parametri da passare alla funzione
 * @param {Object} options - { immediate: true } per eseguire subito
 */
export function useApi(apiFn, params = null, options = { immediate: true }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const execute = useCallback(
    async (overrideParams) => {
      setLoading(true);
      setError(null);
      try {
        const result = await apiFn(overrideParams ?? params);
        setData(result);
        return result;
      } catch (err) {
        setError(err.message || 'Errore sconosciuto');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [apiFn, params]
  );

  useEffect(() => {
    if (options.immediate) {
      execute();
    }
  }, []); // Esegui solo al mount

  return { data, loading, error, execute, setData };
}
