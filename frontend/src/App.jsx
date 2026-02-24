/**
 * LogisticsTrack — App
 * Root component con routing e auth provider.
 *
 * Routing v2.0:
 *   /settings/* → SettingsLayout (Outlet) con sotto-route:
 *     /settings/cameras        → CamerasSettings
 *     /settings/cameras/:id    → CameraDetail (tab Info | Moduli | ROI)
 *     /settings/analyzer       → AnalyzerSettings
 *
 * Route legacy rimosse: /cameras, /rois
 * Route legacy /settings → redirect a /settings/cameras
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import AppLayout from './components/Layout/AppLayout';
import Dashboard from './Pages/Dashboard';
import Events from './Pages/Events';
import VideoAnalyzer from './Pages/VideoAnalyzer';
import SettingsLayout from './Pages/Settings/SettingsLayout';
import CamerasSettings from './Pages/Settings/CamerasSettings';
import CameraDetail from './Pages/Settings/CameraDetail';
import AnalyzerSettings from './Pages/Settings/AnalyzerSettings';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/live" element={<VideoAnalyzer />} />
            <Route path="/events" element={<Events />} />

            {/* Sezione Impostazioni gerarchica */}
            <Route path="/settings" element={<SettingsLayout />}>
              <Route index element={<Navigate to="cameras" replace />} />
              <Route path="cameras" element={<CamerasSettings />} />
              <Route path="cameras/:cameraId" element={<CameraDetail />} />
              <Route path="analyzer" element={<AnalyzerSettings />} />
            </Route>

            {/* Redirect route legacy */}
            <Route path="/cameras" element={<Navigate to="/settings/cameras" replace />} />
            <Route path="/rois" element={<Navigate to="/settings/cameras" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
