import { useEffect, useState, useCallback, useRef } from 'react';
import { ComposableMap, Geographies, Geography, Line, Marker } from 'react-simple-maps';
import api from '../api/client.js';
import { SevBadge } from '../components/Badges.jsx';
import { fmtTime } from '../utils.js';

const GEO_URL = '/countries-110m.json';

// Color the attack by severity (lower = more severe).
const sevColor = (s) => (s <= 2 ? '#f85149' : s <= 3 ? '#ff7b72' : s <= 4 ? '#d29922' : '#2f81f7');

// Built-in description per FortiGate UTM category.
const CATEGORY_INFO = {
  virus: 'Antivirus detection — a file or payload matched a known malware signature.',
  ips: 'Intrusion Prevention — traffic matched a known exploit/attack signature.',
  webfilter: 'Web Filter — access to a malicious or disallowed URL category.',
  'app-ctrl': 'Application Control — a risky or disallowed application was detected.',
  anomaly: 'Anomaly / DoS — abnormal traffic (flood, scan, protocol anomaly).',
  dlp: 'Data Loss Prevention — a sensitive-data pattern matched in traffic.',
  botnet: 'Botnet C2 — communication with a known command-and-control host.',
  attack: 'A known attack signature matched the traffic.',
};
const categoryInfo = (c) => CATEGORY_INFO[c] || 'Detected by the firewall’s security inspection.';

// 2-letter ISO country code -> flag emoji.
function flag(code) {
  if (!code || code.length !== 2 || !/^[A-Z]{2}$/i.test(code)) return '';
  return code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

function publicLinks(t) {
  const name = encodeURIComponent((t.message || '').replace(/\s*\(.*\)\s*$/, '').trim() || t.subtype || 'threat');
  const links = [
    { label: '🔍 FortiGuard', url: `https://www.fortiguard.com/search?q=${name}&engine=1` },
    { label: '🧬 VirusTotal', url: `https://www.virustotal.com/gui/search/${name}` },
    { label: '🌐 Google', url: `https://www.google.com/search?q=${name}%20threat` },
  ];
  if (t.src && !t.src.internal && t.src_ip) {
    links.push({ label: '🛡 AbuseIPDB (src)', url: `https://www.abuseipdb.com/check/${t.src_ip}` });
  }
  return links;
}

export default function Threats() {
  const [filters, setFilters] = useState({ threat: '', category: '', level: '', q: '', hours: 24 });
  const [facets, setFacets] = useState({ categories: [], levels: [] });
  const [threats, setThreats] = useState([]);
  const [arcs, setArcs] = useState([]);
  const [hover, setHover] = useState(null); // { threat, x, y }
  const seen = useRef(new Set());
  const first = useRef(true);
  const closeTimer = useRef(null);

  useEffect(() => { api.get('/threats/facets').then((r) => setFacets(r.data)).catch(() => {}); }, []);

  const load = useCallback(async () => {
    const params = { limit: 200 };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    const { data } = await api.get('/threats', { params });
    setThreats(data);

    const geoOk = data.filter((t) => t.src && t.dst);
    const fresh = first.current ? geoOk.slice(0, 10) : geoOk.filter((t) => !seen.current.has(t.id)).slice(0, 12);
    data.forEach((t) => seen.current.add(t.id));
    if (fresh.length) {
      const now = Date.now();
      const add = fresh.map((t, i) => ({
        key: `${t.id}-${now}-${i}`,
        from: [t.src.lon, t.src.lat], to: [t.dst.lon, t.dst.lat], sev: t.sev_level, born: now,
      }));
      setArcs((prev) => [...prev, ...add].slice(-40));
    }
    first.current = false;
  }, [filters]);

  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);

  // Reap expired arcs.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setArcs((prev) => (prev.length ? prev.filter((a) => now - a.born < 3600) : prev));
    }, 1500);
    return () => clearInterval(id);
  }, []);

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  const showPop = (t, e) => {
    clearTimeout(closeTimer.current);
    const x = Math.min(e.clientX + 14, window.innerWidth - 326);
    const y = Math.min(e.clientY + 8, window.innerHeight - 260);
    setHover({ threat: t, x, y });
  };
  const scheduleClose = () => { closeTimer.current = setTimeout(() => setHover(null), 220); };
  const keepOpen = () => clearTimeout(closeTimer.current);

  const countryCell = (g, ip) => (
    <span>
      <span className="mono">{ip || '—'}</span>
      {g && <span className="muted"> {flag(g.country)} {g.country_name}</span>}
    </span>
  );

  return (
    <div>
      {/* Attack map */}
      <div className="attack-map">
        <ComposableMap projection="geoEqualEarth" projectionConfig={{ scale: 165 }} style={{ width: '100%', height: '100%' }}>
          <Geographies geography={GEO_URL}>
            {({ geographies }) => geographies.map((geo) => (
              <Geography key={geo.rsmKey} geography={geo}
                fill="#16202e" stroke="#26344a" strokeWidth={0.4}
                style={{ default: { outline: 'none' }, hover: { fill: '#1c2a3d', outline: 'none' }, pressed: { outline: 'none' } }} />
            ))}
          </Geographies>
          {arcs.map((a) => (
            <Line key={a.key} from={a.from} to={a.to} stroke={sevColor(a.sev)} strokeWidth={1.1} className="attack-arc" />
          ))}
          {arcs.map((a) => (
            <Marker key={a.key + '-d'} coordinates={a.to}>
              <circle r={3} fill={sevColor(a.sev)} className="attack-pulse" />
              <circle r={1.6} fill={sevColor(a.sev)} />
            </Marker>
          ))}
          {arcs.map((a) => (
            <Marker key={a.key + '-s'} coordinates={a.from}>
              <circle r={1.8} fill="#f85149" />
            </Marker>
          ))}
        </ComposableMap>
        <div className="map-stat">{threats.length} threats · live</div>
        <div className="map-legend">
          <span><span className="dot" style={{ background: '#f85149' }} />source</span>
          <span><span className="dot" style={{ background: '#2f81f7' }} />target</span>
          <span>arc color = severity</span>
        </div>
      </div>

      {/* Filters */}
      <div className="toolbar" style={{ marginTop: 16 }}>
        <input placeholder="Threat name…" value={filters.threat} onChange={set('threat')} style={{ width: 180 }} />
        <select value={filters.category} onChange={set('category')}>
          <option value="">All categories</option>
          {facets.categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filters.level} onChange={set('level')}>
          <option value="">All levels</option>
          {facets.levels.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <input placeholder="Threat info / IP / app…" value={filters.q} onChange={set('q')} style={{ width: 200 }} />
        <select value={filters.hours} onChange={set('hours')}>
          <option value={1}>1h</option><option value={24}>24h</option><option value={168}>7d</option><option value={720}>30d</option>
        </select>
        <div className="spacer" />
        <span className="muted">{threats.length} results · hover a row for threat intel</span>
      </div>

      {/* Threat table */}
      <div className="table-wrap" style={{ maxHeight: 'calc(40vh)' }}>
        <table>
          <thead>
            <tr><th>Time</th><th>Severity</th><th>Category</th><th>Threat</th><th>Source</th><th>Destination</th><th>Device</th><th>Action</th></tr>
          </thead>
          <tbody>
            {threats.map((t) => (
              <tr key={t.id}
                onMouseEnter={(e) => showPop(t, e)} onMouseLeave={scheduleClose}
                style={{ cursor: 'help' }}>
                <td className="mono">{fmtTime(t.ts)}</td>
                <td><SevBadge sev={t.sev_level} level={t.level} /></td>
                <td>{t.subtype || '—'}</td>
                <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.message}</td>
                <td>{countryCell(t.src, t.src_ip)}</td>
                <td>{countryCell(t.dst, t.dst_ip)}</td>
                <td>{t.device_name || '—'}</td>
                <td>{t.action || '—'}</td>
              </tr>
            ))}
            {!threats.length && (
              <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 30 }}>No threats match the filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Hover public-info popover */}
      {hover && (
        <div className="threat-pop" style={{ left: hover.x, top: hover.y }} onMouseEnter={keepOpen} onMouseLeave={scheduleClose}>
          <h4>{hover.threat.message} <SevBadge sev={hover.threat.sev_level} level={hover.threat.level} /></h4>
          <div className="desc">{categoryInfo(hover.threat.subtype)}</div>
          <div className="kv"><span className="muted">Category</span><span>{hover.threat.subtype || '—'}</span></div>
          <div className="kv"><span className="muted">Action</span><span>{hover.threat.action || '—'}</span></div>
          <div className="kv"><span className="muted">Source</span><span className="mono">{hover.threat.src_ip} {hover.threat.src && `${flag(hover.threat.src.country)} ${hover.threat.src.country_name}`}</span></div>
          <div className="kv"><span className="muted">Destination</span><span className="mono">{hover.threat.dst_ip} {hover.threat.dst && `${flag(hover.threat.dst.country)} ${hover.threat.dst.country_name}`}</span></div>
          <div className="links">
            {publicLinks(hover.threat).map((l) => (
              <a key={l.label} href={l.url} target="_blank" rel="noreferrer">{l.label}</a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
