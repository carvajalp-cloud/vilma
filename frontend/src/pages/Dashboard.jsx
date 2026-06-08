import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { fmtNum } from '../utils.js';
import { SOURCES, WIDGETS, DEFAULT_LAYOUT } from '../dashboardWidgets.jsx';

const uid = () => Math.random().toString(36).slice(2, 9);
const STORAGE_KEY = 'faz_dashboard_v2';

// Layout persists per user so different logins keep their own board.
function loadLayout(userId) {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${userId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((w) => WIDGETS[w.type]);
    }
  } catch { /* ignore */ }
  return DEFAULT_LAYOUT.map((type) => ({ iid: uid(), type }));
}

export default function Dashboard() {
  const { user } = useAuth();
  const userId = user?.id ?? 'anon';
  const [hours, setHours] = useState(24);
  const [layout, setLayout] = useState(() => loadLayout(userId));
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showLib, setShowLib] = useState(false);
  const dragIdx = useRef(null);
  const [dragOver, setDragOver] = useState(null);

  // Persist whenever the board changes.
  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}:${userId}`, JSON.stringify(layout));
  }, [layout, userId]);

  // Fetch only the data sources the current widgets need (+ summary for the toolbar).
  const load = useCallback(async () => {
    const needed = new Set(['summary']);
    layout.forEach((w) => WIDGETS[w.type]?.needs.forEach((n) => needed.add(n)));
    const keys = [...needed];
    try {
      const results = await Promise.all(keys.map((k) => SOURCES[k](hours).catch(() => null)));
      const next = {};
      keys.forEach((k, i) => { next[k] = results[i]; });
      setData(next);
    } finally {
      setLoading(false);
    }
  }, [layout, hours]);

  useEffect(() => {
    setLoading(true);
    load();
    const id = setInterval(load, 15000); // live SOC-style refresh
    return () => clearInterval(id);
  }, [load]);

  const ctx = { ...data, hours };

  const addWidget = (type) => setLayout((l) => [...l, { iid: uid(), type }]);
  const removeWidget = (iid) => setLayout((l) => l.filter((w) => w.iid !== iid));
  const resetBoard = () => setLayout(DEFAULT_LAYOUT.map((type) => ({ iid: uid(), type })));

  // --- drag to reorder ---
  const onDragStart = (i) => { dragIdx.current = i; };
  const onDragOver = (e, i) => { e.preventDefault(); setDragOver(i); };
  const onDrop = (i) => {
    const from = dragIdx.current;
    setDragOver(null);
    dragIdx.current = null;
    if (from == null || from === i) return;
    setLayout((l) => {
      const next = [...l];
      const [moved] = next.splice(from, 1);
      next.splice(i, 0, moved);
      return next;
    });
  };

  const syslog = data.summary?.syslog || {};

  return (
    <div>
      <div className="toolbar">
        <label className="muted">Time window:</label>
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          <option value={1}>Last 1 hour</option>
          <option value={6}>Last 6 hours</option>
          <option value={24}>Last 24 hours</option>
          <option value={168}>Last 7 days</option>
          <option value={720}>Last 30 days</option>
        </select>
        <div className="spacer" />
        <span className="pill">
          Syslog: {syslog.listening ? `● listening :${syslog.port}` : '○ off'} · {fmtNum(syslog.received)} rcvd
        </span>
        <button className={`ghost edit-toggle ${editing ? 'active' : ''}`} onClick={() => setEditing((v) => !v)}>
          {editing ? '✓ Done' : '✎ Edit Layout'}
        </button>
        {editing && <button className="ghost" onClick={resetBoard}>↺ Reset</button>}
        <button className="primary" onClick={() => setShowLib(true)}>+ Add Widget</button>
        <button className="ghost" onClick={load}>↻</button>
      </div>

      {editing && (
        <p className="muted" style={{ marginTop: -4, marginBottom: 12, fontSize: 12 }}>
          Drag widgets by their header to rearrange. Click ✕ to remove. Your layout is saved automatically.
        </p>
      )}

      <div className="dash-grid">
        {layout.length === 0 && (
          <div className="widget-empty">
            Your dashboard is empty. Click <strong>+ Add Widget</strong> to build it.
          </div>
        )}
        {layout.map((w, i) => {
          const def = WIDGETS[w.type];
          if (!def) return null;
          return (
            <div
              key={w.iid}
              className={`widget span-${def.span} ${def.kpi ? 'kpi' : ''} ${dragOver === i ? 'drag-over' : ''}`}
              draggable={editing}
              onDragStart={() => onDragStart(i)}
              onDragOver={(e) => editing && onDragOver(e, i)}
              onDrop={() => editing && onDrop(i)}
              onDragEnd={() => setDragOver(null)}
            >
              <div className="widget-head" style={{ cursor: editing ? 'grab' : 'default' }}>
                <span className="widget-title">{editing && '⠿ '}{def.title}</span>
                <div className="widget-actions" style={{ opacity: editing ? 1 : undefined }}>
                  <button title="Remove widget" onClick={() => removeWidget(w.iid)}>✕</button>
                </div>
              </div>
              <div className="widget-body">
                {loading && !data.summary ? <span className="muted">Loading…</span> : def.render(ctx)}
              </div>
            </div>
          );
        })}
      </div>

      {showLib && <WidgetLibrary onAdd={addWidget} onClose={() => setShowLib(false)} />}
    </div>
  );
}

const CAT_TITLES = { KPI: 'KPI Cards', Analysis: 'Analysis', Chart: 'Charts', Table: 'Tables' };

function WidgetLibrary({ onAdd, onClose }) {
  const cats = ['KPI', 'Analysis', 'Chart', 'Table'];
  const byCat = (cat) => Object.entries(WIDGETS).filter(([, d]) => d.category === cat);
  const descFor = (type) => DESCRIPTIONS[type] || '';
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal lib" onClick={(e) => e.stopPropagation()}>
        <div className="flex" style={{ justifyContent: 'space-between' }}>
          <h3>Widget Library</h3>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>Click a widget to add it to your dashboard. You can add the same widget more than once.</p>
        {cats.map((cat) => (
          <div key={cat}>
            <div className="lib-section-title">{CAT_TITLES[cat] || cat}</div>
            <div className="lib-grid">
              {byCat(cat).map(([type, d]) => (
                <button key={type} className="lib-item" onClick={() => onAdd(type)}>
                  <span className="li-title">{d.title}</span>
                  <span className="li-desc">{descFor(type)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const DESCRIPTIONS = {
  kpi_total: 'Total log count in the window',
  kpi_threats: 'Threat detections count',
  kpi_critical: 'Logs at critical severity or higher',
  kpi_events: 'Open events awaiting triage',
  kpi_traffic: 'Traffic session count',
  kpi_bandwidth: 'Total bytes sent + received',
  kpi_devices: 'Online vs total reporting devices',
  timeline: 'Stacked log volume by type over time',
  severity: 'Pie of logs by severity level',
  severity_breakdown: 'All severity levels with counts, %, and colors',
  allowed_blocked: 'Allowed vs blocked traffic with block-rate %',
  top_dst_port: 'Most-targeted destination ports (with service names)',
  insights: 'Key analysis: block rate, peak hour, top threat, busiest device + trends',
  top_src: 'Bar chart of busiest source IPs',
  top_dst: 'Bar chart of busiest destination IPs',
  top_app: 'Bar chart of top applications',
  top_action: 'Pie of firewall actions (accept/deny…)',
  top_protocol: 'Pie of protocols (TCP/UDP/ICMP)',
  recent_threats: 'Latest threat log entries',
  recent_events: 'Latest security events',
  device_status: 'Per-device status and 24h log counts',
};
