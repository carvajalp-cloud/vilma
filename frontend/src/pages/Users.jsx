import { useEffect, useState, useCallback } from 'react';
import api from '../api/client.js';
import { fmtTime } from '../utils.js';

const EMPTY = { username: '', password: '', email: '', role: 'viewer', adom_id: '' };

export default function Users() {
  const [rows, setRows] = useState([]);
  const [adoms, setAdoms] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await api.get('/users');
    setRows(data);
  }, []);

  useEffect(() => {
    load();
    api.get('/adoms').then((r) => setAdoms(r.data)).catch(() => {});
  }, [load]);

  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const body = { ...form };
      if (body.role === 'admin') body.adom_id = null;
      await api.post('/users', body);
      setShowForm(false); setForm(EMPTY); load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create user');
    }
  };

  const del = async (id) => {
    if (!confirm('Delete this user?')) return;
    try {
      await api.delete(`/users/${id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
  };

  const toggleActive = async (u) => {
    await api.put(`/users/${u.id}`, { active: !u.active });
    load();
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div>
      <div className="toolbar">
        <button onClick={load}>↻ Refresh</button>
        <div className="spacer" />
        <button className="primary" onClick={() => { setForm(EMPTY); setShowForm(true); }}>+ Add User</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Username</th><th>Email</th><th>Role</th><th>Customer</th><th>Active</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.email || '—'}</td>
                <td><span className="badge sev-5">{u.role}</span></td>
                <td>{u.adom_name || (u.role === 'admin' ? 'All (global)' : '—')}</td>
                <td>{u.active ? '✔' : '✖'}</td>
                <td className="mono">{fmtTime(u.created_at)}</td>
                <td>
                  <div className="flex">
                    <button className="ghost" onClick={() => toggleActive(u)}>{u.active ? 'Disable' : 'Enable'}</button>
                    <button className="ghost" onClick={() => del(u.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <h3>Add User</h3>
            {error && <div className="error-msg">{error}</div>}
            <div className="field"><label>Username *</label><input value={form.username} onChange={set('username')} required /></div>
            <div className="field"><label>Password *</label><input type="password" value={form.password} onChange={set('password')} required /></div>
            <div className="field"><label>Email</label><input value={form.email} onChange={set('email')} /></div>
            <div className="field"><label>Role</label>
              <select value={form.role} onChange={set('role')}>
                <option value="viewer">Viewer (read-only)</option>
                <option value="analyst">Analyst (manage events/devices)</option>
                <option value="admin">Admin (global)</option>
              </select>
            </div>
            {form.role !== 'admin' && (
              <div className="field"><label>Customer *</label>
                <select value={form.adom_id} onChange={set('adom_id')} required>
                  <option value="">Select customer…</option>
                  {adoms.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}
            <div className="right flex" style={{ justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="primary" type="submit">Create</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
