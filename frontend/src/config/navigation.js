/**
 * LogisticsTrack — Navigation Configuration
 * Voci di menu filtrate per ruolo utente.
 */
import {
  LayoutDashboard,
  CalendarClock,
  Camera,
  Settings,
} from 'lucide-react';

/**
 * Ogni voce ha:
 * - path: route React Router
 * - label: testo visibile
 * - icon: componente Lucide
 * - roles: array di ruoli che vedono questa voce ("admin", "user")
 */
export const navigationItems = [
  {
    path: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    roles: ['admin', 'user'],
  },
  {
    path: '/events',
    label: 'Eventi',
    icon: CalendarClock,
    roles: ['admin', 'user'],
  },
  {
    path: '/cameras',
    label: 'Camere',
    icon: Camera,
    roles: ['admin'],
  },
  {
    path: '/settings',
    label: 'Impostazioni',
    icon: Settings,
    roles: ['admin'],
  },
];

/**
 * Filtra le voci di navigazione per ruolo.
 */
export function getNavigationForRole(role) {
  return navigationItems.filter((item) => item.roles.includes(role));
}
