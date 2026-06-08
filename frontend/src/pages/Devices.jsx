import { useEffect, useState, useCallback } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { fmtTime, fmtNum } from '../utils.js';

const EMPTY = { name: '', ip: '', devid: '', model: '', type: 'firewall', adom_id: '' };

export default function Devices() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [adoms, setAdoms] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const canManage = user?.role === 'admin' || user?.role === 'analyst';

  const load = useCallback(async () => {
    const { data } = await api.get('/devices');
    setRows(data);
  }, []);

  useEffect(() => {
    load();
    if (user?.role === 'admin') api.get('/adoms').then((r) => setAdoms(r.data)).catch(() => {});
  }, [load, user]);

  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const body = { ...form };
      if (user?.role !== 'admin') delete body.adom_id;
      await api.post('/devices', body);
      setShowForm(false); setForm(EMPTY); load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    }
  };

  const del = async (id) => {
    if (!confirm('Delete this device? Its logs will be detached.')) return;
    await api.delete(`/devices/${id}`);
    load();
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div>
      <div className="toolbar">
        <button onClick={load}>↻ Refresh</button>
        <div className="spacer" />
        {canManage && <button className="primary" onClick={() => { setForm(EMPTY); setShowForm(true); }}>+ Add Device</button>}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th><th>IP</th><th>Device ID</th><th>Model</th><th>Type</th>
              <th>Customer</th><th>Status</th><th>Last Seen</th><th>Logs (24h)</th>
              {user?.role === 'admin' && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td className="mono">{d.ip || '—'}</td>
                <td className="mono">{d.devid || '—'}</td>
                <td>{d.model || '—'}</td>
                <td>{d.type}</td>
                <td>{d.adom_name}</td>
                <td><span className={`badge ${d.status}`}>{d.status}</span></td>
                <td className="mono">{d.last_seen ? fmtTime(d.last_seen) : 'never'}</td>
                <td>{fmtNum(d.logs_24h)}</td>
                {user?.role === 'admin' && <td><button className="ghost" onClick={() => del(d.id)}>Delete</button></td>}
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 30 }}>
                No devices registered. They auto-register when they send syslog, or add one manually.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <h3>Add Device</h3>
            {error && <div className="error-msg">{error}</div>}
            <div className="field"><label>Name *</label><input value={form.name} onChange={set('name')} required /></div>
            <div className="field"><label>IP Address</label><input value={form.ip} onChange={set('ip')} placeholder="192.168.1.1" /></div>
            <div className="field"><label>Device ID / Serial</label><input value={form.devid} onChange={set('devid')} placeholder="FG100F0001" /></div>
            <div className="field"><label>Model</label><input value={form.model} onChange={set('model')} placeholder="FortiGate-100F" /></div>
            <div className="field"><label>Type</label>
              <select value={form.type} onChange={set('type')}>
                <option value="firewall">Firewall</option>
                <option value="switch">Switch</option>
                <option value="ap">Access Point</option>
                <option value="other">Other</option>
              </select>
            </div>
            {user?.role === 'admin' && (
              <div className="field"><label>Customer *</label>
                <select value={form.adom_id} onChange={set('adom_id')} required>
                  <option value="">Select customer…</option>
                  {adoms.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}
            <div className="right flex" style={{ justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="primary" type="submit">Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
