import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import api from './api/client.js';
import { fmtBytes, fmtNum, fmtTime, CHART_COLORS, SEV_NAMES } from './utils.js';
import { SevBadge, StatusBadge } from './components/Badges.jsx';

const tip = { contentStyle: { background: '#161b22', border: '1px solid #2d3748' } };

// Rich hover tooltip: shows each series' value, plus % (pie/precomputed) and bytes when present.
function RichTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: '#0d1117', border: '1px solid #2d3748', borderRadius: 6, padding: '8px 10px', fontSize: 12, minWidth: 140 }}>
      {label != null && label !== '' && <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>}
      {payload.map((p, i) => {
        const d = p.payload || {};
        const pctVal = p.percent != null ? Math.round(p.percent * 100) : (d.pct != null ? d.pct : null);
        return (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
            <span style={{ color: p.color || p.fill || d.color }}>{p.name}</span>
            <span style={{ fontWeight: 600 }}>
              {fmtNum(p.value)}{pctVal != null ? ` · ${pctVal}%` : ''}{d.bytes ? ` · ${fmtBytes(d.bytes)}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// --- Data sources: a widget declares which of these it `needs`, and the dashboard
//     fetches only the union needed by the widgets currently on the board. ---
export const SOURCES = {
  summary:        (h) => api.get('/stats/summary', { params: { hours: h } }).then((r) => r.data),
  timeline:       (h) => api.get('/stats/timeline', { params: { hours: h } }).then((r) => r.data),
  severity:       (h) => api.get('/stats/severity', { params: { hours: h } }).then((r) => r.data),
  'top:src_ip':   (h) => api.get('/stats/top', { params: { dim: 'src_ip', hours: h, limit: 8 } }).then((r) => r.data),
  'top:dst_ip':   (h) => api.get('/stats/top', { params: { dim: 'dst_ip', hours: h, limit: 8 } }).then((r) => r.data),
  'top:app':      (h) => api.get('/stats/top', { params: { dim: 'app', hours: h, limit: 8 } }).then((r) => r.data),
  'top:action':   (h) => api.get('/stats/top', { params: { dim: 'action', hours: h, limit: 6 } }).then((r) => r.data),
  'top:protocol': (h) => api.get('/stats/top', { params: { dim: 'protocol', hours: h, limit: 6 } }).then((r) => r.data),
  'top:dst_port': (h) => api.get('/stats/top', { params: { dim: 'dst_port', hours: h, limit: 8 } }).then((r) => r.data),
  insights:       (h) => api.get('/stats/insights', { params: { hours: h } }).then((r) => r.data),
  bandwidth:      (h) => api.get('/stats/bandwidth', { params: { hours: h } }).then((r) => r.data),
  threats:        (h) => api.get('/logs', { params: { log_type: 'threat', hours: h, limit: 8 } }).then((r) => r.data.rows),
  events:         () => api.get('/events', { params: { limit: 8 } }).then((r) => r.data.rows),
  devices:        () => api.get('/devices').then((r) => r.data),
};

// --- small render helpers ---
function Kpi({ value, sub, color }) {
  return (
    <>
      <span className="value" style={color ? { color } : undefined}>{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </>
  );
}

function BarTop({ data, color, vertical }) {
  if (!data || !data.length) return <Empty />;
  if (vertical) {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" />
          <XAxis type="number" stroke="#8b95a5" fontSize={11} />
          <YAxis type="category" dataKey="key" stroke="#8b95a5" fontSize={11} width={110} />
          <Tooltip content={<RichTooltip />} />
          <Bar dataKey="count" fill={color} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ left: -18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" />
        <XAxis dataKey="key" stroke="#8b95a5" fontSize={11} />
        <YAxis stroke="#8b95a5" fontSize={11} />
        <Tooltip content={<RichTooltip />} />
        <Bar dataKey="count" fill={color} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function PieTop({ data, nameKey = 'key' }) {
  if (!data || !data.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label>
          {data.map((e, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
        </Pie>
        <Tooltip content={<RichTooltip />} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

function Empty() {
  return <div className="muted" style={{ textAlign: 'center', padding: 30 }}>No data in this window.</div>;
}

function severityPie(severity) {
  return SEV_NAMES.map((name, i) => ({
    name,
    value: (severity || []).filter((r) => r.sev_level === i).reduce((a, b) => a + b.count, 0),
  })).filter((d) => d.value > 0);
}

function toPie(rows) {
  return (rows || []).map((r) => ({ name: r.key || '—', value: r.count }));
}

// Per-severity colors (Fortinet 0..7: emergency..debug).
const SEV_COLORS = ['#f85149', '#f85149', '#f85149', '#ff7b72', '#d29922', '#2f81f7', '#8b95a5', '#6e7681'];
function severityBars(severity) {
  const rows = SEV_NAMES.map((name, i) => ({
    name, sev: i, color: SEV_COLORS[i] || '#8b95a5',
    count: (severity || []).filter((r) => r.sev_level === i).reduce((a, b) => a + b.count, 0),
  }));
  const total = rows.reduce((a, b) => a + b.count, 0) || 1;
  rows.forEach((d) => { d.pct = Math.round((d.count / total) * 100); });
  return rows.filter((d) => d.count > 0);
}

const PORT_NAMES = { 80: 'HTTP', 443: 'HTTPS', 22: 'SSH', 53: 'DNS', 3389: 'RDP', 445: 'SMB', 25: 'SMTP', 587: 'SMTP', 123: 'NTP', 21: 'FTP', 110: 'POP3', 143: 'IMAP', 8080: 'HTTP-alt', 8443: 'HTTPS-alt', 3306: 'MySQL', 5432: 'PgSQL', 1194: 'OpenVPN', 500: 'IKE', 4500: 'IPsec' };
const portLabel = (port) => (PORT_NAMES[port] ? `${port} ${PORT_NAMES[port]}` : String(port));
const portData = (rows) => (rows || []).map((r) => ({ ...r, key: portLabel(r.key) }));

// --- Widget catalog. type -> definition. ---
// span = grid columns (1..4). needs = data source keys. render(ctx) => JSX.
export const WIDGETS = {
  // KPIs
  kpi_total:     { title: 'Total Logs', category: 'KPI', kpi: true, span: 1, needs: ['summary'], render: (c) => <Kpi value={fmtNum(c.summary?.total_logs)} sub={`last ${c.summary?.window_hours ?? c.hours}h`} /> },
  kpi_threats:   { title: 'Threats', category: 'KPI', kpi: true, span: 1, needs: ['summary'], render: (c) => <Kpi value={fmtNum(c.summary?.threats)} color="var(--red)" sub="detections" /> },
  kpi_critical:  { title: 'Critical+', category: 'KPI', kpi: true, span: 1, needs: ['summary'], render: (c) => <Kpi value={fmtNum(c.summary?.critical)} color="var(--red)" sub="severity ≤ critical" /> },
  kpi_events:    { title: 'Open Events', category: 'KPI', kpi: true, span: 1, needs: ['summary'], render: (c) => <Kpi value={fmtNum(c.summary?.open_events)} color="var(--amber)" sub="needs triage" /> },
  kpi_traffic:   { title: 'Traffic Logs', category: 'KPI', kpi: true, span: 1, needs: ['summary'], render: (c) => <Kpi value={fmtNum(c.summary?.traffic)} color="var(--accent-2)" sub="allowed/denied sessions" /> },
  kpi_bandwidth: { title: 'Bandwidth', category: 'KPI', kpi: true, span: 1, needs: ['summary'], render: (c) => <Kpi value={fmtBytes(c.summary?.bytes)} sub="sent + received" /> },
  kpi_devices:   { title: 'Devices Online', category: 'KPI', kpi: true, span: 1, needs: ['summary'], render: (c) => <Kpi value={`${c.summary?.devices_online ?? 0}/${c.summary?.devices_total ?? 0}`} color="var(--green)" sub="reporting" /> },

  // Charts
  timeline: {
    title: 'Log Volume Over Time', category: 'Chart', span: 4, needs: ['timeline'],
    render: (c) => !c.timeline?.length ? <Empty /> : (
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={c.timeline} margin={{ left: -18 }}>
          <defs>
            <linearGradient id="wgT" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2f81f7" stopOpacity={0.5} /><stop offset="95%" stopColor="#2f81f7" stopOpacity={0} /></linearGradient>
            <linearGradient id="wgX" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f85149" stopOpacity={0.5} /><stop offset="95%" stopColor="#f85149" stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" />
          <XAxis dataKey="label" stroke="#8b95a5" fontSize={11} />
          <YAxis stroke="#8b95a5" fontSize={11} />
          <Tooltip content={<RichTooltip />} /><Legend />
          <Area type="monotone" dataKey="traffic" stroke="#2f81f7" fill="url(#wgT)" />
          <Area type="monotone" dataKey="threat" stroke="#f85149" fill="url(#wgX)" />
          <Area type="monotone" dataKey="event" stroke="#a371f7" fillOpacity={0} />
          <Area type="monotone" dataKey="system" stroke="#d29922" fillOpacity={0} />
        </AreaChart>
      </ResponsiveContainer>
    ),
  },
  severity:     { title: 'Severity Distribution', category: 'Chart', span: 2, needs: ['severity'], render: (c) => <PieTop data={severityPie(c.severity)} /> },
  top_src:      { title: 'Top Source IPs', category: 'Chart', span: 2, needs: ['top:src_ip'], render: (c) => <BarTop data={c['top:src_ip']} color="#2f81f7" vertical /> },
  top_dst:      { title: 'Top Destination IPs', category: 'Chart', span: 2, needs: ['top:dst_ip'], render: (c) => <BarTop data={c['top:dst_ip']} color="#3fb950" vertical /> },
  top_app:      { title: 'Top Applications', category: 'Chart', span: 2, needs: ['top:app'], render: (c) => <BarTop data={c['top:app']} color="#a371f7" /> },
  top_action:   { title: 'Actions', category: 'Chart', span: 2, needs: ['top:action'], render: (c) => <PieTop data={toPie(c['top:action'])} /> },
  top_protocol: { title: 'Protocols', category: 'Chart', span: 2, needs: ['top:protocol'], render: (c) => <PieTop data={toPie(c['top:protocol'])} /> },
  top_dst_port: { title: 'Top Destination Ports', category: 'Chart', span: 2, needs: ['top:dst_port'], render: (c) => <BarTop data={portData(c['top:dst_port'])} color="#d29922" vertical /> },

  // Analysis
  bandwidth_devices: {
    title: 'Bandwidth by Device', category: 'Analysis', span: 2, needs: ['bandwidth'],
    render: (c) => {
      const rows = (c.bandwidth || []).map((r) => ({
        name: r.name, recv: Number(r.recv), sent: Number(r.sent), total: Number(r.recv) + Number(r.sent),
      }));
      if (!rows.length) return <Empty />;
      const totalIn = rows.reduce((a, b) => a + b.recv, 0);
      const totalOut = rows.reduce((a, b) => a + b.sent, 0);
      const max = Math.max(...rows.map((d) => d.total), 1);
      return (
        <div>
          <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 8, fontSize: 12, fontWeight: 600 }}>
            <span style={{ color: 'var(--green)' }}>↓ In {fmtBytes(totalIn)}</span>
            <span style={{ color: 'var(--accent-2)' }}>↑ Out {fmtBytes(totalOut)}</span>
          </div>
          <div style={{ overflow: 'auto', maxHeight: 200 }}>
            {rows.map((d, i) => (
              <div key={i} title={`${d.name}\n↓ in: ${fmtBytes(d.recv)}\n↑ out: ${fmtBytes(d.sent)}\ntotal: ${fmtBytes(d.total)}`} style={{ marginBottom: 9 }}>
                <div className="flex" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                  <span className="muted" style={{ fontSize: 11 }}>
                    <span style={{ color: 'var(--green)' }}>↓{fmtBytes(d.recv)}</span> · <span style={{ color: 'var(--accent-2)' }}>↑{fmtBytes(d.sent)}</span>
                  </span>
                </div>
                <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', background: 'var(--bg-3)', marginTop: 3, width: `${Math.max(5, (d.total / max) * 100)}%` }}>
                  <div style={{ width: `${(d.recv / (d.total || 1)) * 100}%`, background: 'var(--green)' }} />
                  <div style={{ width: `${(d.sent / (d.total || 1)) * 100}%`, background: 'var(--accent-2)' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    },
  },
  severity_breakdown: {
    title: 'Severity Breakdown', category: 'Analysis', span: 2, needs: ['severity'],
    render: (c) => {
      const data = severityBars(c.severity);
      if (!data.length) return <Empty />;
      return (
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" horizontal={false} />
            <XAxis type="number" stroke="#8b95a5" fontSize={11} />
            <YAxis type="category" dataKey="name" stroke="#8b95a5" fontSize={11} width={72} />
            <Tooltip content={<RichTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );
    },
  },
  allowed_blocked: {
    title: 'Allowed vs Blocked', category: 'Analysis', span: 2, needs: ['insights'],
    render: (c) => {
      const tr = c.insights?.traffic;
      if (!tr || (tr.accept + tr.deny) === 0) return <Empty />;
      const total = tr.accept + tr.deny;
      const data = [
        { name: 'Allowed', value: tr.accept, pct: Math.round((tr.accept / total) * 100), color: '#3fb950' },
        { name: 'Blocked', value: tr.deny, pct: Math.round((tr.deny / total) * 100), color: '#f85149' },
      ];
      return (
        <div style={{ position: 'relative' }}>
          <ResponsiveContainer width="100%" height={230}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85}>
                {data.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip content={<RichTooltip />} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ position: 'absolute', top: '40%', left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: tr.block_rate > 0.3 ? 'var(--red)' : 'var(--text)' }}>{Math.round(tr.block_rate * 100)}%</div>
            <div className="muted" style={{ fontSize: 11 }}>blocked</div>
          </div>
        </div>
      );
    },
  },
  insights: {
    title: 'Insights & Trends', category: 'Analysis', span: 2, needs: ['insights'],
    render: (c) => {
      const ins = c.insights;
      if (!ins) return <span className="muted">Loading…</span>;
      const Trend = ({ t, invert }) => {
        if (!t) return null;
        const up = t.pct > 0, down = t.pct < 0;
        const color = t.pct === 0 ? 'var(--text-dim)' : (invert ? (up ? 'var(--red)' : 'var(--green)') : 'var(--accent-2)');
        return <span style={{ color, fontSize: 11 }}>{up ? '▲' : down ? '▼' : '■'} {Math.abs(t.pct)}%</span>;
      };
      const Row = ({ label, value, title }) => (
        <div className="flex" title={title} style={{ justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border)', cursor: 'default' }}>
          <span className="muted" style={{ fontSize: 12 }}>{label}</span>
          <span style={{ fontSize: 13, fontWeight: 600, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
        </div>
      );
      return (
        <div>
          <Row label="Block rate"
               title={`${ins.traffic.deny} blocked of ${ins.traffic.accept + ins.traffic.deny} traffic sessions`}
               value={<span style={{ color: ins.traffic.block_rate > 0.3 ? 'var(--red)' : undefined }}>{Math.round(ins.traffic.block_rate * 100)}% <span className="muted">({fmtNum(ins.traffic.deny)})</span></span>} />
          <Row label="Peak activity" title="Hour with the most log volume" value={ins.peak ? `${ins.peak.label} (${fmtNum(ins.peak.count)})` : '—'} />
          <Row label="Top threat" title={ins.top_threat?.key || 'No threats in window'} value={ins.top_threat ? `${ins.top_threat.key} (${ins.top_threat.count})` : '—'} />
          <Row label="Top blocked source" title="Source IP with the most denied sessions" value={ins.top_blocked_src ? `${ins.top_blocked_src.key} (${ins.top_blocked_src.count})` : '—'} />
          <Row label="Busiest device" title="Device producing the most logs" value={ins.busiest_device ? `${ins.busiest_device.name} (${fmtNum(ins.busiest_device.count)})` : '—'} />
          <div className="flex" style={{ justifyContent: 'space-between', paddingTop: 8, gap: 6 }}>
            <span className="pill" title={`Logs: now ${ins.trend.logs.current} vs previous ${ins.trend.logs.previous}`} style={{ fontSize: 11 }}>Logs <Trend t={ins.trend.logs} /></span>
            <span className="pill" title={`Threats: now ${ins.trend.threats.current} vs previous ${ins.trend.threats.previous}`} style={{ fontSize: 11 }}>Threats <Trend t={ins.trend.threats} invert /></span>
            <span className="pill" title={`Critical: now ${ins.trend.critical.current} vs previous ${ins.trend.critical.previous}`} style={{ fontSize: 11 }}>Critical <Trend t={ins.trend.critical} invert /></span>
          </div>
          <div className="muted" style={{ fontSize: 10, marginTop: 6 }}>▲/▼ vs previous {ins.window_hours}h · hover any row for detail</div>
        </div>
      );
    },
  },

  // Tables
  recent_threats: {
    title: 'Recent Threats', category: 'Table', span: 2, needs: ['threats'],
    render: (c) => !c.threats?.length ? <Empty /> : (
      <div style={{ overflow: 'auto', maxHeight: 240 }}>
        <table><thead><tr><th>Time</th><th>Sev</th><th>Source</th><th>Message</th></tr></thead>
          <tbody>{c.threats.map((t) => (
            <tr key={t.id}><td className="mono">{fmtTime(t.ts)}</td><td><SevBadge sev={t.sev_level} level={t.level} /></td><td className="mono">{t.src_ip}</td><td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.message}</td></tr>
          ))}</tbody>
        </table>
      </div>
    ),
  },
  recent_events: {
    title: 'Recent Events', category: 'Table', span: 2, needs: ['events'],
    render: (c) => !c.events?.length ? <Empty /> : (
      <div style={{ overflow: 'auto', maxHeight: 240 }}>
        <table><thead><tr><th>Time</th><th>Sev</th><th>Title</th><th>Status</th></tr></thead>
          <tbody>{c.events.map((e) => (
            <tr key={e.id}><td className="mono">{fmtTime(e.ts)}</td><td><SevBadge sev={e.sev_level} level={e.level} /></td><td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</td><td><StatusBadge status={e.status} /></td></tr>
          ))}</tbody>
        </table>
      </div>
    ),
  },
  device_status: {
    title: 'Device Status', category: 'Table', span: 2, needs: ['devices'],
    render: (c) => !c.devices?.length ? <Empty /> : (
      <div style={{ overflow: 'auto', maxHeight: 240 }}>
        <table><thead><tr><th>Device</th><th>IP</th><th>Status</th><th>Logs 24h</th></tr></thead>
          <tbody>{c.devices.map((d) => (
            <tr key={d.id}><td>{d.name}</td><td className="mono">{d.ip || '—'}</td><td><span className={`badge ${d.status}`}>{d.status}</span></td><td>{fmtNum(d.logs_24h)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    ),
  },
};

// Default board — KPIs, trend timeline, analysis panels, then top-talkers and recent activity.
export const DEFAULT_LAYOUT = [
  'kpi_total', 'kpi_threats', 'kpi_critical', 'kpi_events',
  'kpi_bandwidth', 'kpi_devices',
  'timeline',
  'insights', 'severity_breakdown',
  'bandwidth_devices', 'allowed_blocked',
  'top_src', 'top_app',
  'top_dst_port', 'recent_threats',
  'recent_events',
];
