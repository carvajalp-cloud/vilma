import { useEffect, useState, useCallback } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { fmtTime, fmtBytes, fmtNum } from '../utils.js';

const BASE_TYPES = [
  { value: 'traffic_summary', label: 'Traffic Summary' },
  { value: 'top_threats', label: 'Top Threats' },
  { value: 'top_sources', label: 'Top Source IPs' },
  { value: 'event_summary', label: 'Event Summary' },
];

// Admin-only summarized report: combined Executive + Security Posture, across all customers.
const ADMIN_TYPES = [
  { value: 'exec_security_summary', label: 'Executive & Security Summary (all customers)' },
];

const GLOBAL_TYPES = new Set(['exec_security_summary']); // span all customers

export default function Reports() {
  const { user, adom } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);
  const [type, setType] = useState('traffic_summary');
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canGenerate = isAdmin || user?.role === 'analyst';

  const load = useCallback(async () => {
    const { data } = await api.get('/reports');
    setList(data);
  }, []);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setError(''); setBusy(true);
    try {
      const isGlobal = GLOBAL_TYPES.has(type);
      // Per-customer reports need a specific customer selected (admins on "All" can't target one).
      if (isAdmin && !isGlobal && (adom === 'all' || !adom)) {
        setError('Select a specific customer (top-right) before generating this report.');
        setBusy(false);
        return;
      }
      const { data } = await api.post('/reports/generate', { type, hours });
      await load();
      const full = await api.get(`/reports/${data.id}`);
      setSelected(full.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate');
    } finally {
      setBusy(false);
    }
  };

  const open = async (id) => {
    const { data } = await api.get(`/reports/${id}`);
    setSelected(data);
  };

  const isGlobalSel = GLOBAL_TYPES.has(type);

  return (
    <div className="grid" style={{ gridTemplateColumns: '320px 1fr', alignItems: 'start' }}>
      <div className="card">
        <h3>Generate Report</h3>
        {error && <div className="error-msg">{error}</div>}
        <div className="field"><label>Report type</label>
          <select value={type} onChange={(e) => setType(e.target.value)} disabled={!canGenerate}>
            <optgroup label="Standard">
              {BASE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </optgroup>
            {isAdmin && (
              <optgroup label="Admin — Summarized">
                {ADMIN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </optgroup>
            )}
          </select>
        </div>
        {isAdmin && isGlobalSel && (
          <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>
            Aggregates across <strong>all customers</strong> — no customer selection needed.
          </p>
        )}
        <div className="field"><label>Time range</label>
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} disabled={!canGenerate}>
            <option value={24}>Last 24 hours</option>
            <option value={168}>Last 7 days</option>
            <option value={720}>Last 30 days</option>
          </select>
        </div>
        <button className="primary" style={{ width: '100%' }} onClick={generate} disabled={!canGenerate || busy}>
          {busy ? 'Generating…' : 'Generate'}
        </button>
        {!canGenerate && <p className="muted" style={{ fontSize: 12 }}>Viewers can open existing reports but not generate new ones.</p>}

        <h3 style={{ marginTop: 20 }}>Saved Reports</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {list.map((r) => (
            <button key={r.id} className="ghost" style={{ textAlign: 'left' }} onClick={() => open(r.id)}>
              {r.name}{r.adom_id == null && <span className="badge sev-5" style={{ marginLeft: 6 }}>global</span>}
              <br /><span className="muted" style={{ fontSize: 11 }}>{fmtTime(r.generated_at)}</span>
            </button>
          ))}
          {!list.length && <span className="muted">No reports yet.</span>}
        </div>
      </div>

      <div className="card">
        {!selected ? (
          <div className="muted" style={{ padding: 40, textAlign: 'center' }}>Generate or open a report to view it.</div>
        ) : (
          <ReportView report={selected} />
        )}
      </div>
    </div>
  );
}

function ReportView({ report }) {
  const d = report.data || {};
  return (
    <div>
      <h3>{report.name} <span className="muted">· {fmtTime(report.generated_at)}</span></h3>

      {/* Executive summary KPI block */}
      {d.summary && (
        <Section title="Summary">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 10 }}>
            <Stat label="Total Logs" value={fmtNum(d.summary.total)} />
            <Stat label="Traffic" value={fmtNum(d.summary.traffic)} />
            <Stat label="Threats" value={fmtNum(d.summary.threats)} color="var(--red)" />
            <Stat label="Critical+" value={fmtNum(d.summary.critical)} color="var(--red)" />
            <Stat label="Bandwidth" value={fmtBytes(d.summary.bytes)} />
            <Stat label="Devices" value={fmtNum(d.summary.devices)} />
            {d.open_events && <Stat label="Open Events" value={fmtNum(d.open_events.open)} color="var(--amber)" />}
          </div>
        </Section>
      )}

      {d.by_type && (
        <Section title="Logs by Type">
          <KV rows={d.by_type.map((r) => [r.log_type, `${fmtNum(r.count)} logs · ${fmtBytes(r.bytes)}`])} />
        </Section>
      )}
      {d.threats_by_severity && (
        <Section title="Threats by Severity">
          <KV rows={d.threats_by_severity.map((r) => [r.level, fmtNum(r.count)])} />
        </Section>
      )}
      {d.severity && (
        <Section title="Severity Distribution">
          <KV rows={d.severity.map((r) => [r.level, fmtNum(r.count)])} />
        </Section>
      )}
      {d.top_apps && (
        <Section title="Top Applications">
          <KV rows={d.top_apps.map((r) => [r.key, fmtNum(r.count)])} />
        </Section>
      )}
      {/* top_threats from executive/security reports */}
      {d.top_threats && (
        <Section title="Top Threats">
          <KV rows={d.top_threats.map((r) => [r.key, fmtNum(r.count)])} />
        </Section>
      )}
      {/* threats from the standalone Top Threats report */}
      {d.threats && (
        <Section title="Top Threats">
          <KV rows={d.threats.map((r) => [r.key, `${fmtNum(r.count)} (${r.level})`])} />
        </Section>
      )}
      {d.top_targets && (
        <Section title="Most Targeted Destinations">
          <KV rows={d.top_targets.map((r) => [r.key, fmtNum(r.count)])} />
        </Section>
      )}
      {d.sources && (
        <Section title="Top Source IPs">
          <KV rows={d.sources.map((r) => [r.key, `${fmtNum(r.count)} · ${fmtBytes(r.bytes)}`])} />
        </Section>
      )}
      {d.events && (
        <Section title="Events">
          <KV rows={d.events.map((r) => [
            r.category ? `${r.category} · ${r.status}` : r.status,
            fmtNum(r.count),
          ])} />
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return <div style={{ marginBottom: 18 }}><h3>{title}</h3>{children}</div>;
}

function Stat({ label, value, color }) {
  return (
    <div className="card" style={{ padding: 10 }}>
      <div className="muted" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function KV({ rows }) {
  if (!rows.length) return <span className="muted">No data.</span>;
  return (
    <table>
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={i}><td style={{ whiteSpace: 'normal' }}>{k || '—'}</td><td className="right">{v}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
