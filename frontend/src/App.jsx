import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Threats from './pages/Threats.jsx';
import LogViewer from './pages/LogViewer.jsx';
import Devices from './pages/Devices.jsx';
import Events from './pages/Events.jsx';
import Reports from './pages/Reports.jsx';
import Users from './pages/Users.jsx';
import Adoms from './pages/Adoms.jsx';

export default function App() {
  const { loading } = useAuth();
  if (loading) return <div className="spin">Loading…</div>;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/threats" element={<Threats />} />
        <Route path="/logs" element={<LogViewer />} />
        <Route path="/devices" element={<Devices />} />
        <Route path="/events" element={<Events />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/admin/users" element={<ProtectedRoute roles={['admin']}><Users /></ProtectedRoute>} />
        <Route path="/admin/adoms" element={<ProtectedRoute roles={['admin']}><Adoms /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
