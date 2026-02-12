/**
 * LogisticsTrack — Header
 * Barra superiore con stato sistema e info utente.
 */
import { useEffect, useState } from 'react';
import { Activity, Wifi, WifiOff, Menu } from 'lucide-react';
import { fetchHealth } from '../../services/api';

export default function Header({ onMobileMenuToggle }) {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    const check = async () => {
      try {
        const data = await fetchHealth();
        setHealth(data);
      } catch {
        setHealth(null);
      }
    };

    check();
    const interval = setInterval(check, 15000); // Ogni 15s
    return () => clearInterval(interval);
  }, []);

  const backendOk = health?.status === 'ok';
  const mqttOk = health?.mqtt_connected;

  return (
    <header className="h-14 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4">
      {/* Mobile menu toggle */}
      <button
        onClick={onMobileMenuToggle}
        className="lg:hidden text-slate-400 hover:text-white"
      >
        <Menu size={20} />
      </button>

      {/* Titolo pagina — spazio vuoto su desktop, usato dal layout */}
      <div className="flex-1" />

      {/* Status indicators */}
      <div className="flex items-center gap-4 text-xs">
        {/* Backend */}
        <div className="flex items-center gap-1.5">
          <Activity size={14} className={backendOk ? 'text-green-400' : 'text-red-400'} />
          <span className={`hidden sm:inline ${backendOk ? 'text-green-400' : 'text-red-400'}`}>
            API
          </span>
        </div>

        {/* MQTT */}
        <div className="flex items-center gap-1.5">
          {mqttOk ? (
            <Wifi size={14} className="text-green-400" />
          ) : (
            <WifiOff size={14} className="text-red-400" />
          )}
          <span className={`hidden sm:inline ${mqttOk ? 'text-green-400' : 'text-red-400'}`}>
            MQTT
          </span>
        </div>
      </div>
    </header>
  );
}
