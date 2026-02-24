/**
 * LogisticsTrack — Settings Layout
 * Layout con sub-navigazione interna:
 *   - Telecamere (/settings/cameras)
 *   - Video Analyzer (/settings/analyzer)
 *
 * Usa <Outlet /> per renderizzare le pagine figlie.
 */
import { NavLink, Outlet } from 'react-router-dom';
import { Camera, Cpu } from 'lucide-react';

const SUB_NAV = [
  { path: '/settings/cameras', label: 'Telecamere', icon: Camera },
  { path: '/settings/analyzer', label: 'Video Analyzer', icon: Cpu },
];

export default function SettingsLayout() {
  return (
    <div className="flex gap-6 min-h-full">
      {/* Sub-sidebar */}
      <aside className="w-44 shrink-0">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-1">
          Impostazioni
        </h2>
        <nav className="space-y-1">
          {SUB_NAV.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors
                ${isActive
                  ? 'bg-blue-600/20 text-blue-400'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`
              }
            >
              <Icon size={15} className="shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Contenuto pagina */}
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
