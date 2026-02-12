/**
 * LogisticsTrack — Sidebar
 * Navigazione laterale collapsabile con voci filtrate per ruolo.
 */
import { NavLink } from 'react-router-dom';
import { Camera, PanelLeftClose, PanelLeft } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { getNavigationForRole } from '../../config/navigation';

export default function Sidebar({ collapsed, onToggle }) {
  const { role } = useAuth();
  const items = getNavigationForRole(role);

  return (
    <aside
      className={`
        fixed top-0 left-0 z-40 h-screen
        bg-slate-900 border-r border-slate-800
        flex flex-col
        transition-all duration-200 ease-in-out
        ${collapsed ? 'w-16' : 'w-56'}
      `}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-14 border-b border-slate-800">
        <div className="bg-blue-600 p-1.5 rounded-lg shrink-0">
          <Camera size={18} className="text-white" />
        </div>
        {!collapsed && (
          <span className="text-sm font-bold text-white tracking-tight truncate">
            LogisticsTrack
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm
              transition-colors duration-150
              ${
                isActive
                  ? 'bg-blue-600/20 text-blue-400'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }
              ${collapsed ? 'justify-center' : ''}`
            }
            title={collapsed ? item.label : undefined}
          >
            <item.icon size={18} className="shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="flex items-center justify-center h-12 border-t border-slate-800
                   text-slate-500 hover:text-slate-300 transition-colors"
        title={collapsed ? 'Espandi sidebar' : 'Comprimi sidebar'}
      >
        {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
      </button>
    </aside>
  );
}
