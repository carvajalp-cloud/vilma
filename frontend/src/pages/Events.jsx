import { useEffect, useState, useCallback } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { SevBadge, StatusBadge } from '../components/Badges.jsx';
import { fmtTime, fmtNum, SEV_NAMES } from '../utils.js';

export default function Events() {
  const [view, setView] = useState('events');
  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <div className="flex" style={{ gap: 0, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          <button className={view === 'events' ? 'primary' : 'ghost'} style={{ borderRadius: 0 }} onClick={() => setView('events')}>Events</button>
          <button className={view === 'rules' ? 'primary' : 'ghost'} style={{ borderRadius: 0 }} onClick={() => setView('rules')}>Event Definitions</button>
        </div>
      </div>
      {view === 'events' ? <EventsList /> : <RulesManager />}
    </div>
  );
}

// -------------------- Events list (triage) --------------------
function EventsList() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const canManage = user?.role === 'admin' || user?.role === 'analyst';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 200 };
      if (status) params.status = status;
      const { data } = await api.get('/events', { params });
      setRows(data.rows);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id, newStatus) => {
    await api.patch(`/events/${id}`, { status: newStatus });
    load();
  };

  return (
    <div>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="ack">Acknowledged</option>
          <option value="closed">Closed</option>
        </select>
        <button onClick={load}>↻ Refresh</button>
        <div className="spacer" />
        <span className="muted">{fmtNum(total)} events</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th><th>Severity</th><th>Category</th><th>Title</th>
              <th>Device</th><th>Status</th><th>Assignee</th>{canManage && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="mono">{fmtTime(e.ts)}</td>
                <td><SevBadge sev={e.sev_level} level={e.level} /></td>
                <td>{e.category}</td>
                <td style={{ whiteSpace: 'normal', maxWidth: 360 }}>{e.title}</td>
                <td>{e.device_name || '—'}</td>
                <td><StatusBadge status={e.status} /></td>
                <td>{e.assignee || '—'}</td>
                {canManage && (
                  <td>
                    <div className="flex">
                      {e.status !== 'ack' && <button className="ghost" onClick={() => updateStatus(e.id, 'ack')}>Ack</button>}
                      {e.status !== 'closed' && <button className="ghost" onClick={() => updateStatus(e.id, 'closed')}>Close</button>}
                      {e.status !== 'open' && <button className="ghost" onClick={() => updateStatus(e.id, 'open')}>Reopen</button>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr><td colSpan={canManage ? 8 : 7} className="muted" style={{ textAlign: 'center', padding: 30 }}>No events.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// -------------------- Event definitions (alert rules) --------------------
const TYPE_LABELS = { any: 'Any log', traffic: 'Traffic', threat: 'Threat', event: 'Event', system: 'System' };

// sev_min: a log triggers when its severity is at or above this level (sev_level <= sev_min).
function severityLabel(sev) {
  if (sev >= 7) return 'Any severity';
  return `${SEV_NAMES[sev]} or higher`;
}

function conditionLabel(r) {
  if (!r.op || r.op === 'any' || !r.field) return '—';
  return `${r.field} ${r.op} "${r.value}"`;
}

const EMPTY_RULE = {
  name: '', adom_id: '', log_type: 'any', sev_min: 3,
  field: '', op: 'any', value: '', category: 'General', enabled: true,
};

function RulesManager() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [adoms, setAdoms] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_RULE);
  const [editId, setEditId] = useState(null);
  const [error, setError] = useState('');
  const canManage = user?.role === 'admin' || user?.role === 'analyst';

  const load = useCallback(async () => {
    const { data } = await api.get('/events/rules/list');
    setRows(data);
  }, []);

  useEffect(() => {
    load();
    api.get('/adoms').then((r) => setAdoms(r.data)).catch(() => {});
  }, [load]);

  const adomName = (id) => adoms.find((a) => a.id === id)?.name || id;

  const openCreate = () => {
    setError(''); setEditId(null);
    setForm({ ...EMPTY_RULE, adom_id: user?.role === 'admin' ? '' : (user?.adom_id ?? '') });
    setShowForm(true);
  };
  const openEdit = (r) => {
    setError(''); setEditId(r.id);
    setForm({
      name: r.name, adom_id: r.adom_id, log_type: r.log_type, sev_min: r.sev_min,
      field: r.field || '', op: r.op || 'any', value: r.value || '', category: r.category || 'General', enabled: r.enabled,
    });
    setShowForm(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const body = { ...form, sev_min: Number(form.sev_min) };
      if (user?.role !== 'admin') delete body.adom_id;
      if (editId) await api.patch(`/events/rules/${editId}`, body);
      else await api.post('/events/rules', body);
      setShowForm(false); load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save definition');
    }
  };

  const toggle = async (r) => {
    await api.patch(`/events/rules/${r.id}`, { enabled: !r.enabled });
    load();
  };
  const del = async (r) => {
    if (!confirm(`Delete event definition "${r.name}"?`)) return;
    await api.delete(`/events/rules/${r.id}`);
    load();
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div>
      <p className="muted" style={{ marginTop: -4, marginBottom: 12, fontSize: 13 }}>
        Define which logs are automatically raised as <strong>events</strong>, by <strong>customer</strong> and
        <strong> severity</strong> (plus optional log type and field condition). Changes apply to newly ingested logs immediately.
      </p>
      <div className="toolbar">
        <button onClick={load}>↻ Refresh</button>
        <div className="spacer" />
        <span className="muted">{fmtNum(rows.length)} definitions</span>
        {canManage && <button className="primary" onClick={openCreate}>+ New Definition</button>}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Customer</th><th>Applies to</th><th>Severity threshold</th>
              <th>Condition</th><th>Category</th><th>Status</th>{canManage && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.adom_name || adomName(r.adom_id)}</td>
                <td>{TYPE_LABELS[r.log_type] || r.log_type}</td>
                <td><span className={`badge sev-${r.sev_min}`}>{severityLabel(r.sev_min)}</span></td>
                <td className="mono">{conditionLabel(r)}</td>
                <td>{r.category}</td>
                <td>
                  {canManage
                    ? <button className="ghost" onClick={() => toggle(r)}><span className={`badge ${r.enabled ? 'online' : 'offline'}`}>{r.enabled ? 'Enabled' : 'Disabled'}</span></button>
                    : <span className={`badge ${r.enabled ? 'online' : 'offline'}`}>{r.enabled ? 'Enabled' : 'Disabled'}</span>}
                </td>
                {canManage && (
                  <td>
                    <div className="flex">
                      <button className="ghost" onClick={() => openEdit(r)}>Edit</button>
                      <button className="ghost" onClick={() => del(r)}>Delete</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={canManage ? 8 : 7} className="muted" style={{ textAlign: 'center', padding: 30 }}>
                No event definitions yet. {canManage && 'Click “+ New Definition” to create one.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <h3>{editId ? 'Edit Event Definition' : 'New Event Definition'}</h3>
            {error && <div className="error-msg">{error}</div>}

            <div className="field"><label>Name *</label>
              <input value={form.name} onChange={set('name')} placeholder="e.g. Critical threats for Acme" required />
            </div>

            <div className="field"><label>Customer *</label>
              {user?.role === 'admin' ? (
                <select value={form.adom_id} onChange={set('adom_id')} required>
                  <option value="">Select customer…</option>
                  {adoms.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              ) : (
                <input value={adomName(user?.adom_id)} disabled />
              )}
            </div>

            <div className="field"><label>Raise an event when severity is *</label>
              <select value={form.sev_min} onChange={set('sev_min')}>
                {[0, 1, 2, 3, 4, 5, 6].map((s) => (
                  <option key={s} value={s}>{SEV_NAMES[s]} or higher</option>
                ))}
                <option value={7}>Any severity</option>
              </select>
            </div>

            <div className="field"><label>Applies to log type</label>
              <select value={form.log_type} onChange={set('log_type')}>
                {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>

            <details style={{ marginBottom: 14 }}>
              <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>Optional field condition</summary>
              <div className="flex" style={{ marginTop: 10, alignItems: 'flex-end' }}>
                <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>Field</label>
                  <select value={form.field} onChange={set('field')}>
                    <option value="">(none)</option>
                    <option value="action">action</option>
                    <option value="app">app</option>
                    <option value="src_ip">src_ip</option>
                    <option value="dst_ip">dst_ip</option>
                    <option value="protocol">protocol</option>
                    <option value="user_name">user</option>
                  </select>
                </div>
                <div className="field" style={{ width: 110, marginBottom: 0 }}><label>Operator</label>
                  <select value={form.op} onChange={set('op')}>
                    <option value="any">any</option>
                    <option value="eq">equals</option>
                    <option value="neq">not equals</option>
                    <option value="contains">contains</option>
                  </select>
                </div>
                <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>Value</label>
                  <input value={form.value} onChange={set('value')} placeholder="e.g. deny" disabled={form.op === 'any' || !form.field} />
                </div>
              </div>
            </details>

            <div className="flex" style={{ marginBottom: 14 }}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>Category</label>
                <input value={form.category} onChange={set('category')} placeholder="General" />
              </div>
              <label className="flex" style={{ marginTop: 18 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={form.enabled}
                  onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
                Enabled
              </label>
            </div>

            <div className="right flex" style={{ justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="primary" type="submit">{editId ? 'Save' : 'Create'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
