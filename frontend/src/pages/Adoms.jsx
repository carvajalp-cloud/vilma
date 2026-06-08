import { useEffect, useState, useCallback } from 'react';
import api from '../api/client.js';
import { fmtTime } from '../utils.js';

export default function Adoms() {
  const [rows, setRows] = useState([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await api.get('/adoms');
    setRows(data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/adoms', { name, description });
      setName(''); setDescription(''); load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed');
    }
  };

  const del = async (id) => {
    if (!confirm('Delete this customer? All its devices, logs and events will be removed.')) return;
    try {
      await api.delete(`/adoms/${id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: '320px 1fr', alignItems: 'start' }}>
      <form className="card" onSubmit={create}>
        <h3>New Customer</h3>
        {error && <div className="error-msg">{error}</div>}
        <div className="field"><label>Name *</label><input value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div className="field"><label>Description</label><input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <button className="primary" style={{ width: '100%' }} type="submit">Create Customer</button>
        <p className="muted" style={{ fontSize: 12 }}>
          Customers isolate devices, logs and events per tenant. Non-admin users are scoped to one customer.
        </p>
      </form>

      <div className="card">
        <h3>Customers</h3>
        <table>
          <thead><tr><th>Name</th><th>Description</th><th>Devices</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td style={{ whiteSpace: 'normal' }}>{a.description || '—'}</td>
                <td>{a.device_count ?? '—'}</td>
                <td className="mono">{fmtTime(a.created_at)}</td>
                <td><button className="ghost" onClick={() => del(a.id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
