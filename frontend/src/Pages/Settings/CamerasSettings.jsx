/**
 * LogisticsTrack — Cameras Settings
 * Lista camere + CRUD. Sostituisce la vecchia Cameras.jsx.
 * Da qui si naviga al dettaglio camera (/settings/cameras/:id).
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Camera,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  X,
  ChevronRight,
} from 'lucide-react';
import { fetchCameras, createCamera, deleteCamera } from '../../services/api';

export default function CamerasSettings() {
  const navigate = useNavigate();
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    id: '', name: '', rtsp_url: '', location: '', is_active: true,
  });

  const loadCameras = async () => {
    setLoading(true);
    try {
      const data = await fetchCameras();
      setCameras(data || []);
    } catch (err) {
      console.error('Errore caricamento camere:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCameras(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await createCamera(formData);
      setShowForm(false);
      setFormData({ id: '', name: '', rtsp_url: '', location: '', is_active: true });
      loadCameras();
    } catch (err) {
      alert(`Errore: ${err.message}`);
    }
  };

  const handleDelete = async (cam, e) => {
    e.stopPropagation();
    if (!confirm(`Eliminare la camera "${cam.id}"? Verranno eliminate anche le ROI associate.`)) return;
    try {
      await deleteCamera(cam.id);
      loadCameras();
    } catch (err) {
      alert(`Errore: ${err.message}`);
    }
  };

  const inputCls = 'bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500 w-full';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Telecamere</h1>
          <p className="text-sm text-slate-500 mt-1">{cameras.length} camere registrate</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-500 transition-colors"
        >
          {showForm ? <X size={14} /> : <Plus size={14} />}
          {showForm ? 'Annulla' : 'Nuova Camera'}
        </button>
      </div>

      {/* Form creazione */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">ID Camera *</label>
              <input type="text" required value={formData.id} onChange={(e) => setFormData({ ...formData, id: e.target.value })} placeholder="es. CAM_MAG_01" className={inputCls} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Nome *</label>
              <input type="text" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="es. Camera Magazzino Nord" className={inputCls} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">URL RTSP</label>
              <input type="text" value={formData.rtsp_url} onChange={(e) => setFormData({ ...formData, rtsp_url: e.target.value })} placeholder="rtsp://user:pass@192.168.0.100:554/..." className={inputCls} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Posizione</label>
              <input type="text" value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })} placeholder="es. Magazzino A - Ingresso Nord" className={inputCls} />
            </div>
          </div>
          <button type="submit" className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-500 transition-colors">
            Salva Camera
          </button>
        </form>
      )}

      {/* Lista camere */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {loading ? (
          <div className="col-span-full text-center py-12 text-slate-600">Caricamento...</div>
        ) : cameras.length === 0 ? (
          <div className="col-span-full text-center py-12 text-slate-600">
            Nessuna camera. Usa "Nuova Camera" per aggiungerne una.
          </div>
        ) : (
          cameras.map((cam) => (
            <div
              key={cam.id}
              onClick={() => navigate(`/settings/cameras/${cam.id}`)}
              className="bg-slate-900/50 border border-slate-800 rounded-xl p-4
                         hover:border-slate-600 cursor-pointer transition-colors group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Camera size={16} className="text-slate-500 shrink-0" />
                  <span className="font-medium text-white text-sm truncate">{cam.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {cam.is_active
                    ? <CheckCircle2 size={14} className="text-green-400" />
                    : <XCircle size={14} className="text-red-400" />
                  }
                  <ChevronRight size={14} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
                </div>
              </div>

              <div className="space-y-1 text-xs text-slate-500">
                <div>
                  <span className="text-slate-600">ID:</span>{' '}
                  <span className="font-mono text-slate-400">{cam.id}</span>
                </div>
                {cam.rtsp_url && (
                  <div className="truncate">
                    <span className="text-slate-600">RTSP:</span>{' '}
                    <span className="font-mono text-slate-400 text-xs">{cam.rtsp_url}</span>
                  </div>
                )}
                {cam.location && (
                  <div>
                    <span className="text-slate-600">Posizione:</span>{' '}
                    <span className="text-slate-400">{cam.location}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-800">
                <button
                  onClick={(e) => handleDelete(cam, e)}
                  className="flex items-center gap-1 text-xs text-red-400/50 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={12} />
                  Elimina
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
