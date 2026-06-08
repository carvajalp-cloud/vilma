import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import api from './api/client.js';
import { fmtBytes, fmtNum, fmtTime, CHART_COLORS, SEV_NAMES } from './utils.js';
import { SevBadge, StatusBadge } from './components/Badges.jsx';

const tip = { contentStyle: { background: '#161b22', border: '1px solid #2d3748' } };

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
          <Tooltip {...tip} />
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
        <Tooltip {...tip} />
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
        <Tooltip {...tip} />
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
          <Tooltip {...tip} /><Legend />
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

// Default board shown to a brand-new user (mirrors the original fixed dashboard).
export const DEFAULT_LAYOUT = [
  'kpi_total', 'kpi_threats', 'kpi_critical', 'kpi_events',
  'kpi_bandwidth', 'kpi_devices',
  'timeline',
  'severity', 'top_src', 'top_app',
];
