import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import AdomSelector from './AdomSelector.jsx';

const TITLES = {
  '/': 'Dashboard',
  '/threats': 'Threat Map',
  '/logs': 'Log Viewer',
  '/devices': 'Device Manager',
  '/events': 'Event Monitor',
  '/reports': 'Reports',
  '/admin/users': 'User Management',
  '/admin/adoms': 'Customer Management',
};

export default function Layout() {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const title = TITLES[loc.pathname] || 'Vilma';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="logo">◆</span> Vilma</div>
        <nav className="nav">
          <NavLink to="/" end>▦ Dashboard</NavLink>
          <NavLink to="/threats">⊕ Threats</NavLink>
          <NavLink to="/logs">≣ Log Viewer</NavLink>
          <NavLink to="/events">⚠ Events</NavLink>
          <NavLink to="/devices">▣ Devices</NavLink>
          <NavLink to="/reports">▤ Reports</NavLink>
          {user?.role === 'admin' && (
            <>
              <div className="nav-section">Administration</div>
              <NavLink to="/admin/users">⚇ Users</NavLink>
              <NavLink to="/admin/adoms">⊞ Customers</NavLink>
            </>
          )}
        </nav>
        <div style={{ padding: 12, borderTop: '1px solid var(--border)', fontSize: 12 }} className="muted">
          v1.0 · syslog ingest
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="left">
            <h1>{title}</h1>
          </div>
          <div className="flex">
            <AdomSelector />
            <span className="pill">{user?.username} · <span className="muted">{user?.role}</span></span>
            <button className="ghost" onClick={logout}>Logout</button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
