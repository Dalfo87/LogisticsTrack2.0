/**
 * LogisticsTrack — Camera Detail
 * Dettaglio camera con tre tab:
 *   - Info: nome, RTSP, posizione, attiva, snapshot
 *   - Moduli: toggle enable/disable per modulo
 *   - ROI: editor ROI filtrato per modulo
 *
 * Route: /settings/cameras/:cameraId
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Camera,
  ChevronLeft,
  Info,
  Package,
  Layers,
  CheckCircle2,
  XCircle,
  Save,
  RefreshCw,
} from 'lucide-react';
import { fetchCamera, updateCamera, getCameraSnapshotUrl } from '../../services/api';
import ModulesTab from './ModulesTab';
import ROITab from './ROITab';

const TABS = [
  { id: 'info',    label: 'Info',    icon: Info },
  { id: 'modules', label: 'Moduli',  icon: Package },
  { id: 'roi',     label: 'ROI',     icon: Layers },
];

export default function CameraDetail() {
  const { cameraId } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('info');
  const [camera, setCamera] = useState(null);
  const [loading, setLoading] = useState(true);

  // Form edit info
  const [editData, setEditData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [snapshotKey, setSnapshotKey] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await fetchCamera(cameraId);
        setCamera(data);
        setEditData({
          id: data.id,
          name: data.name,
          rtsp_url: data.rtsp_url || '',
          location: data.location || '',
          is_active: data.is_active,
          modules_config: data.modules_config || null,
        });
      } catch (err) {
        console.error('Errore caricamento camera:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [cameraId]);

  const handleSaveInfo = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveResult(null);
    try {
      const updated = await updateCamera(cameraId, editData);
      setCamera(updated);
      setSaveResult('success');
      setTimeout(() => setSaveResult(null), 3000);
    } catch (err) {
      setSaveResult('error');
      setTimeout(() => setSaveResult(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500 w-full';

  if (loading) {
    return <div className="py-12 text-center text-slate-600">Caricamento...</div>;
  }

  if (!camera) {
    return (
      <div className="py-12 text-center text-slate-600">
        <p>Camera non trovata.</p>
        <button onClick={() => navigate('/settings/cameras')} className="mt-4 text-blue-400 text-sm hover:underline">
          ← Torna alle telecamere
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb + Header */}
      <div>
        <Link
          to="/settings/cameras"
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 mb-3 transition-colors"
        >
          <ChevronLeft size={13} />
          Telecamere
        </Link>
        <div className="flex items-center gap-3">
          <div className="bg-slate-800 p-2 rounded-lg">
            <Camera size={18} className="text-slate-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{camera.name}</h1>
            <p className="text-sm text-slate-500 font-mono">{camera.id}</p>
          </div>
          <div className="ml-2">
            {camera.is_active
              ? <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle2 size={13} /> Attiva</span>
              : <span className="flex items-center gap-1 text-xs text-red-400"><XCircle size={13} /> Inattiva</span>
            }
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-800">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 transition-colors -mb-px
              ${activeTab === id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab: Info */}
      {activeTab === 'info' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Form */}
          <form onSubmit={handleSaveInfo} className="space-y-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Nome *</label>
              <input type="text" required value={editData?.name ?? ''} onChange={(e) => setEditData({ ...editData, name: e.target.value })} className={inputCls} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">URL RTSP</label>
              <input type="text" value={editData?.rtsp_url ?? ''} onChange={(e) => setEditData({ ...editData, rtsp_url: e.target.value })} placeholder="rtsp://user:pass@192.168.0.100:554/..." className={inputCls} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Posizione</label>
              <input type="text" value={editData?.location ?? ''} onChange={(e) => setEditData({ ...editData, location: e.target.value })} placeholder="es. Magazzino A - Ingresso Nord" className={inputCls} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">Camera attiva</span>
              <button
                type="button"
                onClick={() => setEditData({ ...editData, is_active: !editData.is_active })}
                className={`relative w-11 h-6 rounded-full transition-colors ${editData?.is_active ? 'bg-blue-600' : 'bg-slate-700'}`}
              >
                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${editData?.is_active ? 'left-6' : 'left-1'}`} />
              </button>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-500 disabled:opacity-50 transition-colors"
              >
                {saving
                  ? <><RefreshCw size={13} className="animate-spin" /> Salvataggio…</>
                  : <><Save size={13} /> Salva</>
                }
              </button>
              {saveResult === 'success' && <span className="text-xs text-emerald-400">✓ Salvato</span>}
              {saveResult === 'error' && <span className="text-xs text-red-400">✗ Errore</span>}
            </div>
          </form>

          {/* Snapshot preview */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Snapshot</span>
              <button
                onClick={() => setSnapshotKey((k) => k + 1)}
                className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"
              >
                <RefreshCw size={12} /> Aggiorna
              </button>
            </div>
            <img
              key={snapshotKey}
              src={`${getCameraSnapshotUrl(cameraId)}?t=${snapshotKey}`}
              alt="Snapshot camera"
              className="w-full rounded-xl border border-slate-800 object-cover"
              style={{ maxHeight: '220px' }}
            />
            {camera.location && (
              <p className="text-xs text-slate-500">
                <span className="text-slate-600">Posizione:</span> {camera.location}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Tab: Moduli */}
      {activeTab === 'modules' && (
        <ModulesTab cameraId={cameraId} />
      )}

      {/* Tab: ROI */}
      {activeTab === 'roi' && (
        <ROITab cameraId={cameraId} />
      )}
    </div>
  );
}
