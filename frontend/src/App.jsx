/**
 * LogisticsTrack — App
 * Root component con routing e auth provider.
 */
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import AppLayout from './components/Layout/AppLayout';
import Dashboard from './Pages/Dashboard';
import Events from './Pages/Events';
import Cameras from './Pages/Cameras';
import ROIEditor from './Pages/ROIEditor';
import Settings from './Pages/Settings';
import VideoAnalyzer from './Pages/VideoAnalyzer';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/live" element={<VideoAnalyzer />} />
            <Route path="/events" element={<Events />} />
            <Route path="/cameras" element={<Cameras />} />
            <Route path="/rois" element={<ROIEditor />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
