import { useEffect, useState, useCallback } from 'react';
import api from '../api/client.js';
import { fmtTime } from '../utils.js';

export default function Users() {
  const [rows, setRows] = useState([]);
  const [adoms, setAdoms] = useState([]);
  const [modal, setModal] = useState(null); // { mode: 'create'|'edit', user }

  const load = useCallback(async () => {
    const { data } = await api.get('/users');
    setRows(data);
  }, []);

  useEffect(() => {
    load();
    api.get('/adoms').then((r) => setAdoms(r.data)).catch(() => {});
  }, [load]);

  const del = async (id) => {
    if (!confirm('Delete this user?')) return;
    try { await api.delete(`/users/${id}`); load(); }
    catch (err) { alert(err.response?.data?.error || 'Failed'); }
  };
  const toggleActive = async (u) => { await api.put(`/users/${u.id}`, { active: !u.active }); load(); };

  const customerLabel = (u) =>
    u.role === 'admin' ? 'All (global)' : (u.customers?.length ? u.customers.map((c) => c.name).join(', ') : '—');

  return (
    <div>
      <div className="toolbar">
        <button onClick={load}>↻ Refresh</button>
        <div className="spacer" />
        <button className="primary" onClick={() => setModal({ mode: 'create', user: null })}>+ Add User</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Username</th><th>Email</th><th>Role</th><th>Customers</th><th>Active</th><th>Created</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.email || '—'}</td>
                <td><span className="badge sev-5">{u.role}</span></td>
                <td style={{ whiteSpace: 'normal', maxWidth: 280 }}>{customerLabel(u)}</td>
                <td>{u.active ? '✔' : '✖'}</td>
                <td className="mono">{fmtTime(u.created_at)}</td>
                <td>
                  <div className="flex">
                    <button className="ghost" onClick={() => setModal({ mode: 'edit', user: u })}>Edit</button>
                    <button className="ghost" onClick={() => toggleActive(u)}>{u.active ? 'Disable' : 'Enable'}</button>
                    <button className="ghost" onClick={() => del(u.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <UserForm
          mode={modal.mode}
          user={modal.user}
          adoms={adoms}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}

function UserForm({ mode, user, adoms, onClose, onSaved }) {
  const [username, setUsername] = useState(user?.username || '');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState(user?.email || '');
  const [role, setRole] = useState(user?.role || 'viewer');
  const [active, setActive] = useState(user ? user.active : true);
  const [adomIds, setAdomIds] = useState((user?.customers || []).map((c) => c.id));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // A user that is ALREADY an admin can't have its password changed here.
  const targetIsAdmin = mode === 'edit' && user?.role === 'admin';
  const showPassword = !targetIsAdmin;

  const toggleCustomer = (id) =>
    setAdomIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const save = async (e) => {
    e.preventDefault();
    setError('');
    if (role !== 'admin' && adomIds.length === 0) {
      setError('Assign at least one customer (or set the role to Admin).');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'create') {
        await api.post('/users', {
          username, password, email, role,
          adom_ids: role === 'admin' ? [] : adomIds,
        });
      } else {
        const body = { email, role, active };
        if (role !== 'admin') body.adom_ids = adomIds;
        if (showPassword && password) body.password = password;
        await api.put(`/users/${user.id}`, body);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save user');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h3>{mode === 'create' ? 'Add User' : `Edit User — ${user.username}`}</h3>
        {error && <div className="error-msg">{error}</div>}

        {mode === 'create' && (
          <div className="field"><label>Username *</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
        )}

        {showPassword ? (
          <div className="field">
            <label>{mode === 'create' ? 'Password *' : 'New password'}</label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              required={mode === 'create'}
              placeholder={mode === 'edit' ? 'leave blank to keep current' : ''}
            />
          </div>
        ) : (
          <div className="field">
            <label>Password</label>
            <div className="pill muted" style={{ fontSize: 12 }}>An admin user's password can't be changed here.</div>
          </div>
        )}

        <div className="field"><label>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>

        <div className="field"><label>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="viewer">Viewer (read-only)</option>
            <option value="analyst">Analyst (manage events/devices)</option>
            <option value="admin">Admin (global)</option>
          </select>
        </div>

        {role !== 'admin' && (
          <div className="field">
            <label>Customers <span className="muted">(assign one or more)</span></label>
            <div style={{ maxHeight: 160, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
              {adoms.length === 0 && <span className="muted" style={{ fontSize: 12 }}>No customers exist yet.</span>}
              {adoms.map((a) => (
                <label key={a.id} className="flex" style={{ padding: '3px 0', cursor: 'pointer' }}>
                  <input
                    type="checkbox" style={{ width: 'auto' }}
                    checked={adomIds.includes(a.id)}
                    onChange={() => toggleCustomer(a.id)}
                  />
                  {a.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {mode === 'edit' && (
          <label className="flex" style={{ marginBottom: 14 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active
          </label>
        )}

        <div className="right flex" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : (mode === 'create' ? 'Create' : 'Save')}</button>
        </div>
      </form>
    </div>
  );
}
