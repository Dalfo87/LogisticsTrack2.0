/**
 * LogisticsTrack — Navigation Configuration
 * Voci di menu filtrate per ruolo utente.
 * Supporta voci collassibili con figli (campo children).
 */
import {
  LayoutDashboard,
  Video,
  CalendarClock,
  Settings,
  Camera,
  Cpu,
} from 'lucide-react';

/**
 * Ogni voce ha:
 * - path: route React Router
 * - label: testo visibile
 * - icon: componente Lucide
 * - roles: array di ruoli che vedono questa voce ("admin", "user")
 * - collapsible: (opzionale) se true, la voce ha un toggle expand/collapse
 * - children: (opzionale) array di sotto-voci (stessa struttura, no roles)
 */
export const navigationItems = [
  {
    path: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    roles: ['admin', 'user'],
  },
  {
    path: '/live',
    label: 'Video Live',
    icon: Video,
    roles: ['admin', 'user'],
  },
  {
    path: '/events',
    label: 'Eventi',
    icon: CalendarClock,
    roles: ['admin', 'user'],
  },
  {
    path: '/settings',
    label: 'Impostazioni',
    icon: Settings,
    roles: ['admin'],
    collapsible: true,
    children: [
      { path: '/settings/cameras', label: 'Telecamere', icon: Camera },
      { path: '/settings/analyzer', label: 'Video Analyzer', icon: Cpu },
    ],
  },
];

/**
 * Filtra le voci di navigazione per ruolo.
 */
export function getNavigationForRole(role) {
  return navigationItems.filter((item) => item.roles.includes(role));
}
