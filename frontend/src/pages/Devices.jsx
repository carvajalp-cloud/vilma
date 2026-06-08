import { useEffect, useState, useCallback } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { fmtTime, fmtNum, fmtBytes } from '../utils.js';

const BLANK = { name: '', devid: '', model: '', type: 'firewall', status: 'unknown', adom_id: '', ips: [], quota_bytes: null };

const GB = 1024 ** 3;
const TB = 1024 ** 4;
const quotaToBytes = (value, unit) => {
  const n = Number(value);
  if (!value || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * (unit === 'TB' ? TB : GB));
};
const bytesToQuota = (bytes) => {
  if (!bytes) return { value: '', unit: 'GB' };
  return bytes >= TB
    ? { value: +(bytes / TB).toFixed(2), unit: 'TB' }
    : { value: +(bytes / GB).toFixed(2), unit: 'GB' };
};

// Small usage/quota bar for the table.
function StorageCell({ usage, quota }) {
  if (!quota) return <span className="mono">{fmtBytes(usage)}<span className="muted"> / ∞</span></span>;
  const pct = Math.min(100, Math.round((usage / quota) * 100));
  const color = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--amber)' : 'var(--green)';
  return (
    <div style={{ minWidth: 120 }}>
      <span className="mono" style={{ fontSize: 12 }}>{fmtBytes(usage)} / {fmtBytes(quota)}</span>
      <div style={{ height: 5, background: 'var(--bg-3)', borderRadius: 3, marginTop: 3 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

export default function Devices() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [adoms, setAdoms] = useState([]);
  const [modal, setModal] = useState(null); // { mode: 'create'|'edit', device }
  const canManage = user?.role === 'admin' || user?.role === 'analyst';

  const load = useCallback(async () => {
    const { data } = await api.get('/devices');
    setRows(data);
  }, []);

  useEffect(() => {
    load();
    if (user?.role === 'admin') api.get('/adoms').then((r) => setAdoms(r.data)).catch(() => {});
  }, [load, user]);

  const del = async (id) => {
    if (!confirm('Delete this device? Its logs will be detached and its IP mappings removed.')) return;
    await api.delete(`/devices/${id}`);
    load();
  };

  return (
    <div>
      <div className="toolbar">
        <button onClick={load}>↻ Refresh</button>
        <div className="spacer" />
        {canManage && <button className="primary" onClick={() => setModal({ mode: 'create', device: { ...BLANK } })}>+ Add Device</button>}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Source IPs</th><th>Serial</th><th>Type</th>
              <th>Customer</th><th>Status</th><th>Storage (used / quota)</th><th>Last Seen</th><th>Logs (24h)</th>
              {canManage && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td className="mono">
                  {d.ips && d.ips.length
                    ? d.ips.map((ip) => <span key={ip} className="pill" style={{ marginRight: 4, padding: '1px 6px' }}>{ip}</span>)
                    : '—'}
                </td>
                <td className="mono">{d.devid || '—'}</td>
                <td>{d.type}</td>
                <td>{d.adom_name}</td>
                <td><span className={`badge ${d.status}`}>{d.status}</span></td>
                <td><StorageCell usage={d.usage_bytes} quota={d.quota_bytes} /></td>
                <td className="mono">{d.last_seen ? fmtTime(d.last_seen) : 'never'}</td>
                <td>{fmtNum(d.logs_24h)}</td>
                {canManage && (
                  <td>
                    <div className="flex">
                      <button className="ghost" onClick={() => setModal({ mode: 'edit', device: { ...BLANK, ...d, ips: d.ips || [] } })}>Edit</button>
                      {user?.role === 'admin' && <button className="ghost" onClick={() => del(d.id)}>Delete</button>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={canManage ? 10 : 9} className="muted" style={{ textAlign: 'center', padding: 30 }}>
                No devices yet. They auto-register when they send syslog, or add one manually.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <DeviceForm
          mode={modal.mode}
          device={modal.device}
          adoms={adoms}
          isAdmin={user?.role === 'admin'}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}

function DeviceForm({ mode, device, adoms, isAdmin, onClose, onSaved }) {
  const [form, setForm] = useState(device);
  const [ipInput, setIpInput] = useState('');
  const initQuota = bytesToQuota(device.quota_bytes);
  const [quotaValue, setQuotaValue] = useState(initQuota.value);
  const [quotaUnit, setQuotaUnit] = useState(initQuota.unit);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const addIp = () => {
    const ip = ipInput.trim();
    if (!ip) return;
    if (form.ips.includes(ip)) { setIpInput(''); return; }
    setForm((f) => ({ ...f, ips: [...f.ips, ip] }));
    setIpInput('');
  };
  const removeIp = (ip) => setForm((f) => ({ ...f, ips: f.ips.filter((x) => x !== ip) }));

  const save = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const body = {
        name: form.name, devid: form.devid || null, model: form.model,
        type: form.type, status: form.status, ips: form.ips,
        quota_bytes: quotaToBytes(quotaValue, quotaUnit),
      };
      if (mode === 'create') {
        if (isAdmin) body.adom_id = form.adom_id;
        await api.post('/devices', body);
      } else {
        await api.put(`/devices/${form.id}`, body);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h3>{mode === 'create' ? 'Add Device' : `Edit Device — ${device.name}`}</h3>
        {error && <div className="error-msg">{error}</div>}

        <div className="field"><label>Name *</label>
          <input value={form.name} onChange={set('name')} required />
        </div>
        <div className="field"><label>Serial / Device ID</label>
          <input value={form.devid || ''} onChange={set('devid')} placeholder="FGT60F..." />
          <span className="muted" style={{ fontSize: 11 }}>Primary match key — logs with this serial map here regardless of source IP (SD-WAN safe).</span>
        </div>

        {/* Multiple source IPs */}
        <div className="field">
          <label>Source IPs <span className="muted">(SD-WAN: add each WAN IP this device sends from)</span></label>
          <div className="flex" style={{ marginBottom: 8 }}>
            <input
              value={ipInput}
              onChange={(e) => setIpInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addIp(); } }}
              placeholder="e.g. 200.1.2.3"
              style={{ flex: 1 }}
            />
            <button type="button" onClick={addIp}>Add IP</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {form.ips.length === 0 && <span className="muted" style={{ fontSize: 12 }}>No IPs yet — added manually here, or auto-learned from traffic by serial.</span>}
            {form.ips.map((ip) => (
              <span key={ip} className="pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {ip}
                <button type="button" onClick={() => removeIp(ip)} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', padding: 0, cursor: 'pointer' }}>✕</button>
              </span>
            ))}
          </div>
        </div>

        <div className="flex">
          <div className="field" style={{ flex: 1, marginBottom: 0 }}><label>Model</label>
            <input value={form.model || ''} onChange={set('model')} placeholder="FortiGate-60F" />
          </div>
          <div className="field" style={{ width: 130, marginBottom: 0 }}><label>Type</label>
            <select value={form.type} onChange={set('type')}>
              <option value="firewall">Firewall</option>
              <option value="switch">Switch</option>
              <option value="ap">Access Point</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        {/* Rolling storage quota */}
        <div className="field" style={{ marginTop: 14 }}>
          <label>Storage quota <span className="muted">(when exceeded, oldest logs are deleted — newest kept)</span></label>
          <div className="flex">
            <input
              type="number" min="0" step="any" value={quotaValue}
              onChange={(e) => setQuotaValue(e.target.value)}
              placeholder="unlimited" style={{ flex: 1 }}
            />
            <select value={quotaUnit} onChange={(e) => setQuotaUnit(e.target.value)} style={{ width: 90 }}>
              <option value="GB">GB</option>
              <option value="TB">TB</option>
            </select>
          </div>
          <span className="muted" style={{ fontSize: 11 }}>Leave blank for unlimited retention.</span>
        </div>

        {mode === 'edit' && (
          <div className="field" style={{ marginTop: 14 }}><label>Status</label>
            <select value={form.status} onChange={set('status')}>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
        )}

        {mode === 'create' && isAdmin && (
          <div className="field" style={{ marginTop: 14 }}><label>Customer *</label>
            <select value={form.adom_id} onChange={set('adom_id')} required>
              <option value="">Select customer…</option>
              {adoms.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}

        <div className="right flex" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
