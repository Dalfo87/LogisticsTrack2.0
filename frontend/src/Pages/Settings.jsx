/**
 * LogisticsTrack — Settings Page
 * Placeholder per configurazioni admin (Fase 5+).
 */
import { Settings as SettingsIcon, Construction } from 'lucide-react';

export default function Settings() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white">Impostazioni</h1>
        <p className="text-sm text-slate-500 mt-1">Configurazione sistema</p>
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-8 text-center">
        <Construction size={40} className="mx-auto text-slate-600 mb-4" />
        <p className="text-slate-400 text-sm">
          Le impostazioni saranno disponibili nelle prossime fasi.
        </p>
        <p className="text-slate-600 text-xs mt-2">
          Previste: ROI Editor, parametri analisi, gestione utenti, configurazione WMS.
        </p>
      </div>
    </div>
  );
}
