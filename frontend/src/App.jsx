import React, { useState, useEffect } from 'react';
import { Camera, Activity } from 'lucide-react';

const App = () => {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    fetch('/api/../health')
      .then(res => res.json())
      .then(data => setHealth(data))
      .catch(() => setHealth({ status: 'offline' }));
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center">
      <div className="text-center space-y-6">
        <div className="flex items-center justify-center gap-4">
          <div className="bg-blue-600 p-4 rounded-2xl shadow-lg shadow-blue-500/20">
            <Camera size={40} className="text-white" />
          </div>
          <div className="text-left">
            <h1 className="text-4xl font-black text-white tracking-tight">LogisticsTrack</h1>
            <p className="text-slate-400 text-sm font-medium uppercase tracking-widest">
              Forensic Analysis System
            </p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 text-sm">
          <Activity size={16} className={health?.status === 'ok' ? 'text-green-400' : 'text-red-400'} />
          <span className="text-slate-400">
            Backend: {health?.status === 'ok' ? 'Connesso' : 'Non raggiungibile'}
          </span>
        </div>

        <p className="text-slate-500 text-sm">
          Dashboard in sviluppo — Fase 4
        </p>
      </div>
    </div>
  );
};

export default App;
