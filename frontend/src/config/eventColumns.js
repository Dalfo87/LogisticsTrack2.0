/**
 * LogisticsTrack — Event Table Columns Configuration
 *
 * Definisce le colonne visibili nella tabella eventi.
 * Per aggiungere un campo: aggiungi un oggetto a questo array.
 * Non serve toccare il componente DataTable.
 */

import { format } from 'date-fns';
import { it } from 'date-fns/locale';

/**
 * Ogni colonna ha:
 * - key: chiave nel JSON dell'evento
 * - label: intestazione colonna
 * - sortable: se ordinabile
 * - render: funzione custom per rendering (opzionale)
 * - className: classi Tailwind aggiuntive (opzionale)
 * - visible: visibilità di default (opzionale, default true)
 * - minWidth: larghezza minima (opzionale)
 */
export const eventColumns = [
  {
    key: 'id',
    label: 'ID',
    sortable: true,
    className: 'font-mono text-xs',
    minWidth: '60px',
  },
  {
    key: 'timestamp',
    label: 'Data/Ora',
    sortable: true,
    render: (value) => {
      if (!value) return '—';
      try {
        return format(new Date(value), 'dd/MM/yy HH:mm:ss', { locale: it });
      } catch {
        return value;
      }
    },
    minWidth: '150px',
  },
  {
    key: 'event_type',
    label: 'Tipo',
    sortable: true,
    render: (value) => {
      const labels = {
        roi_enter: 'Ingresso',
        roi_exit: 'Uscita',
        dwell_time: 'Sosta',
      };
      const colors = {
        roi_enter: 'bg-green-500/20 text-green-400',
        roi_exit: 'bg-blue-500/20 text-blue-400',
        dwell_time: 'bg-amber-500/20 text-amber-400',
      };
      const label = labels[value] || value;
      const color = colors[value] || 'bg-slate-500/20 text-slate-400';
      return `<span class="px-2 py-0.5 rounded text-xs font-medium ${color}">${label}</span>`;
    },
    isHtml: true,
    minWidth: '100px',
  },
  {
    key: 'camera_id',
    label: 'Camera',
    sortable: true,
    className: 'font-mono text-xs',
    minWidth: '120px',
  },
  {
    key: 'aisle_id',
    label: 'Corsia',
    sortable: true,
    minWidth: '80px',
  },
  {
    key: 'track_id',
    label: 'Track',
    sortable: true,
    className: 'font-mono',
    minWidth: '70px',
  },
  {
    key: 'raw_data',
    label: 'Conf.',
    sortable: false,
    render: (value) => {
      if (!value || !value.confidence) return '—';
      const pct = Math.round(value.confidence * 100);
      const color = pct >= 80 ? 'text-green-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400';
      return `<span class="font-mono text-xs ${color}">${pct}%</span>`;
    },
    isHtml: true,
    minWidth: '60px',
  },
  {
    key: 'raw_data',
    label: 'Dwell',
    sortable: false,
    render: (value) => {
      if (!value || !value.dwell_seconds) return '—';
      return `${value.dwell_seconds.toFixed(1)}s`;
    },
    className: 'font-mono text-xs',
    minWidth: '70px',
    // Chiave unica per evitare conflitto con l'altra colonna raw_data
    uniqueKey: 'dwell',
  },
  {
    key: 'validated',
    label: 'Validato',
    sortable: true,
    render: (value) => {
      if (value) {
        return '<span class="text-green-400">✓</span>';
      }
      return '<span class="text-slate-600">—</span>';
    },
    isHtml: true,
    minWidth: '80px',
  },
];

/**
 * Definizione filtri disponibili per la tabella eventi.
 */
export const eventFilters = [
  {
    key: 'event_type',
    label: 'Tipo evento',
    type: 'select',
    options: [
      { value: '', label: 'Tutti' },
      { value: 'roi_enter', label: 'Ingresso' },
      { value: 'roi_exit', label: 'Uscita' },
      { value: 'dwell_time', label: 'Sosta' },
    ],
  },
  {
    key: 'camera_id',
    label: 'Camera',
    type: 'text',
    placeholder: 'es. CAM_DEV_01',
  },
  {
    key: 'aisle_id',
    label: 'Corsia',
    type: 'text',
    placeholder: 'es. A-01',
  },
  {
    key: 'track_id',
    label: 'Track ID',
    type: 'number',
    placeholder: 'es. 5',
  },
  {
    key: 'validated',
    label: 'Validato',
    type: 'select',
    options: [
      { value: '', label: 'Tutti' },
      { value: 'true', label: 'Sì' },
      { value: 'false', label: 'No' },
    ],
  },
  {
    key: 'date_from',
    label: 'Da',
    type: 'datetime-local',
  },
  {
    key: 'date_to',
    label: 'A',
    type: 'datetime-local',
  },
];
