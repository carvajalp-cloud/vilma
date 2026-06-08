import { useEffect, useState, useCallback } from 'react';
import api from '../api/client.js';
import { SevBadge, TypeBadge } from '../components/Badges.jsx';
import { fmtTime, fmtBytes, fmtNum } from '../utils.js';

const PAGE = 100;

export default function LogViewer() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ q: '', log_type: '', level: '', action: '', hours: 24 });

  const load = useCallback(async (off = 0) => {
    setLoading(true);
    try {
      const params = { limit: PAGE, offset: off };
      Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
      const { data } = await api.get('/logs', { params });
      setRows(data.rows);
      setTotal(data.total);
      setOffset(off);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(0); }, [load]);

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div>
      <div className="toolbar">
        <input
          placeholder="Search message, IP, app…"
          value={filters.q}
          onChange={set('q')}
          onKeyDown={(e) => e.key === 'Enter' && load(0)}
          style={{ width: 260 }}
        />
        <select value={filters.log_type} onChange={set('log_type')}>
          <option value="">All types</option>
          <option value="traffic">Traffic</option>
          <option value="threat">Threat</option>
          <option value="event">Event</option>
          <option value="system">System</option>
        </select>
        <select value={filters.level} onChange={set('level')}>
          <option value="">All severities</option>
          {['emergency', 'alert', 'critical', 'error', 'warning', 'notice', 'information'].map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <select value={filters.hours} onChange={set('hours')}>
          <option value={1}>1h</option>
          <option value={24}>24h</option>
          <option value={168}>7d</option>
          <option value={720}>30d</option>
        </select>
        <button className="primary" onClick={() => load(0)}>Search</button>
        <div className="spacer" />
        <span className="muted">{fmtNum(total)} results</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th><th>Type</th><th>Severity</th><th>Device</th>
              <th>Source</th><th>Destination</th><th>App</th><th>Action</th><th>Message</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => setSelected(r)} style={{ cursor: 'pointer' }}>
                <td className="mono">{fmtTime(r.ts)}</td>
                <td><TypeBadge type={r.log_type} /></td>
                <td><SevBadge sev={r.sev_level} level={r.level} /></td>
                <td>{r.device_name || '—'}</td>
                <td className="mono">{r.src_ip}{r.src_port ? `:${r.src_port}` : ''}</td>
                <td className="mono">{r.dst_ip}{r.dst_port ? `:${r.dst_port}` : ''}</td>
                <td>{r.app || '—'}</td>
                <td>{r.action || '—'}</td>
                <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.message}</td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 30 }}>No logs match the filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="toolbar" style={{ marginTop: 12 }}>
        <button disabled={offset === 0 || loading} onClick={() => load(Math.max(0, offset - PAGE))}>← Prev</button>
        <span className="muted">{offset + 1}–{Math.min(offset + PAGE, total)} of {fmtNum(total)}</span>
        <button disabled={offset + PAGE >= total || loading} onClick={() => load(offset + PAGE)}>Next →</button>
      </div>

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h3>Log #{selected.id} <TypeBadge type={selected.log_type} /> <SevBadge sev={selected.sev_level} level={selected.level} /></h3>
            <table>
              <tbody>
                {[
                  ['Time', fmtTime(selected.ts)],
                  ['Device', selected.device_name],
                  ['Subtype', selected.subtype],
                  ['Source', `${selected.src_ip || ''}${selected.src_port ? ':' + selected.src_port : ''}`],
                  ['Destination', `${selected.dst_ip || ''}${selected.dst_port ? ':' + selected.dst_port : ''}`],
                  ['Protocol', selected.protocol],
                  ['Application', selected.app],
                  ['Action', selected.action],
                  ['User', selected.user_name],
                  ['Bytes sent', fmtBytes(selected.bytes_sent)],
                  ['Bytes recv', fmtBytes(selected.bytes_recv)],
                  ['Message', selected.message],
                ].map(([k, v]) => (
                  <tr key={k}><td className="muted">{k}</td><td style={{ whiteSpace: 'normal' }}>{v || '—'}</td></tr>
                ))}
              </tbody>
            </table>
            {selected.raw && (
              <>
                <h3 style={{ marginTop: 14 }}>Raw</h3>
                <div className="mono" style={{ background: 'var(--bg)', padding: 10, borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{selected.raw}</div>
              </>
            )}
            <div className="right" style={{ marginTop: 14 }}>
              <button onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
