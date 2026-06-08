import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../api/client.js';

// ADOM (tenant) switcher. Admins can pick any ADOM or "All"; others are locked.
export default function AdomSelector() {
  const { user, adom, setAdom } = useAuth();
  const [adoms, setAdoms] = useState([]);

  useEffect(() => {
    api.get('/adoms').then((r) => setAdoms(r.data)).catch(() => {});
  }, []);

  if (user?.role !== 'admin') {
    // Multiple assigned customers -> let them switch between their own.
    if (adoms.length > 1) {
      return (
        <select value={adom} onChange={(e) => { setAdom(e.target.value); window.location.reload(); }}>
          {adoms.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      );
    }
    const current = adoms.find((a) => String(a.id) === String(adom)) || adoms[0];
    return <span className="pill">Customer: {current?.name || user?.adom_id || '—'}</span>;
  }

  return (
    <select value={adom} onChange={(e) => { setAdom(e.target.value); window.location.reload(); }}>
      <option value="all">All Customers</option>
      {adoms.map((a) => (
        <option key={a.id} value={a.id}>{a.name}</option>
      ))}
    </select>
  );
}
