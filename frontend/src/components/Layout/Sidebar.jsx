/**
 * LogisticsTrack — Sidebar
 * Navigazione laterale collassabile con voci filtrate per ruolo.
 * Supporta voci con figli (collapsible: true + children[]).
 */
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Camera, PanelLeftClose, PanelLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { getNavigationForRole } from '../../config/navigation';

export default function Sidebar({ collapsed, onToggle }) {
  const { role } = useAuth();
  const location = useLocation();
  const items = getNavigationForRole(role);

  // Stato espansione per voci collassibili
  // Inizializza come aperto se il path corrente è un figlio
  const initExpanded = (item) =>
    item.children?.some((c) => location.pathname.startsWith(c.path)) ?? false;

  const [expanded, setExpanded] = useState(() => {
    const state = {};
    items.forEach((item) => {
      if (item.collapsible) state[item.path] = initExpanded(item);
    });
    return state;
  });

  const toggleExpanded = (path, e) => {
    e.preventDefault();
    setExpanded((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const navLinkCls = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm
     transition-colors duration-150
     ${isActive
       ? 'bg-blue-600/20 text-blue-400'
       : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
     }
     ${collapsed ? 'justify-center' : ''}`;

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
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {items.map((item) => {
          const hasChildren = item.collapsible && item.children?.length > 0;
          const isOpen = expanded[item.path];
          // Voce padre attiva se il path corrente inizia con quello della voce
          const isParentActive = location.pathname.startsWith(item.path) && item.path !== '/';
          const isExactActive = item.path === '/' && location.pathname === '/';

          if (!hasChildren) {
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={navLinkCls}
                title={collapsed ? item.label : undefined}
              >
                <item.icon size={18} className="shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            );
          }

          // Voce collapsible con figli
          return (
            <div key={item.path}>
              <button
                onClick={(e) => toggleExpanded(item.path, e)}
                title={collapsed ? item.label : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm
                  transition-colors duration-150
                  ${isParentActive || isExactActive
                    ? 'bg-blue-600/20 text-blue-400'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }
                  ${collapsed ? 'justify-center' : ''}`}
              >
                <item.icon size={18} className="shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">{item.label}</span>
                    {isOpen
                      ? <ChevronDown size={13} className="shrink-0 text-slate-500" />
                      : <ChevronRight size={13} className="shrink-0 text-slate-500" />
                    }
                  </>
                )}
              </button>

              {/* Sub-voci */}
              {!collapsed && isOpen && (
                <div className="mt-0.5 ml-4 pl-3 border-l border-slate-800 space-y-0.5">
                  {item.children.map((child) => (
                    <NavLink
                      key={child.path}
                      to={child.path}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm
                         transition-colors duration-150
                         ${isActive
                           ? 'bg-blue-600/20 text-blue-400'
                           : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
                         }`
                      }
                    >
                      <child.icon size={15} className="shrink-0" />
                      <span>{child.label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
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
